#!/usr/bin/env python3
"""Materialise a Web release from an already-installed baseline plus a delta archive.

Every file is verified against the new release manifest before the service slot is
switched. Unchanged files are hard-linked to the baseline release, so the new
release costs almost no extra disk and no extra transfer.

Usage:
  deploy-delta.py --delta /tmp/web-delta.tar.gz --sha256 <hex> --manifest /tmp/new-release.json \
      --release 20261017-04 --base 20261017-03 --expect-base-commit <40-hex> \
      --slot 3104 [--dry-run] [--skip-restart]
"""
import argparse, hashlib, json, os, pathlib, shutil, sqlite3, subprocess, sys, tarfile, time

ROOT = pathlib.Path('/srv/sites/jigsaw')
SERVICE = 'jigsaw-web@{slot}.service'
OWNER = 'web-jigsaw'


def fail(code, message):
    print(json.dumps({'ok': False, 'code': code, 'message': message}, ensure_ascii=False))
    sys.exit(2)


def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def safe_path(name):
    part = pathlib.PurePosixPath(name)
    if not name or str(part) != name or part.is_absolute() or any(p in ('', '.', '..') for p in part.parts) or '\\' in name:
        fail('UNSAFE_PATH', 'unsafe release path: ' + name)
    return name


def health(slot, expect_release=None):
    url = 'http://127.0.0.1:%s/api/health' % slot
    for _ in range(15):
        result = subprocess.run(['curl', '-s', '-m', '4', '-H', 'Host: jigsawnook.online',
                                 '-H', 'X-Forwarded-Proto: https', url], capture_output=True, text=True)
        try:
            body = json.loads(result.stdout)
        except Exception:
            time.sleep(2)
            continue
        if body.get('ok') is True and (expect_release is None or body.get('contentReleaseId') == expect_release):
            return body
        time.sleep(2)
    return None


def main():
    parser = argparse.ArgumentParser()
    for name in ('delta', 'sha256', 'manifest', 'release', 'base', 'expect-base-commit', 'slot'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--skip-restart', action='store_true')
    options = parser.parse_args()

    archive = pathlib.Path(options.delta)
    if not archive.is_file() or digest(archive) != options.sha256:
        fail('DELTA_SHA_MISMATCH', 'delta archive digest differs')
    manifest = json.loads(pathlib.Path(options.manifest).read_text(encoding='utf-8'))
    files = {safe_path(item['path']): item for item in manifest.get('files', [])}
    if manifest.get('app') != 'jigsaw-nook' or manifest.get('dirty') is not False or not files:
        fail('MANIFEST_INVALID', 'not a clean Web release manifest')

    base_app = ROOT / 'releases' / options.base / 'app'
    base_manifest = json.loads((base_app / 'release.json').read_text(encoding='utf-8'))
    if base_manifest.get('gitCommit') != options.expect_base_commit:
        fail('BASE_COMMIT_MISMATCH', 'installed baseline commit differs')

    target_dir = ROOT / 'releases' / options.release
    app = target_dir / 'app'
    staging = target_dir / ('app.tmp-' + str(os.getpid()))
    if app.exists():
        fail('RELEASE_EXISTS', 'release already exists: ' + options.release)

    print(json.dumps({'step': 'staging', 'files': len(files), 'release': options.release}, ensure_ascii=False))
    if options.dry_run:
        print(json.dumps({'ok': True, 'mode': 'dry-run', 'files': len(files)}))
        return

    staging.mkdir(parents=True)
    linked = extracted = 0
    pending = {}
    for name, record in files.items():
        source = base_app / name
        destination = staging / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_file() and source.stat().st_size == record['bytes'] and digest(source) == record['sha256']:
            os.link(source, destination)
            linked += 1
        else:
            pending[name] = record

    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle.getmembers():
            if not member.isfile():
                continue
            name = safe_path(member.name)
            if name not in pending:
                continue
            handle = bundle.extractfile(member)
            (staging / name).parent.mkdir(parents=True, exist_ok=True)
            with open(staging / name, 'wb') as out:
                shutil.copyfileobj(handle, out)
            extracted += 1

    # Keep the previous build's hashed client chunks resolvable: a page opened
    # before this release still references them, and a missing chunk blanks it.
    kept = 0
    old_client = base_app / 'dist' / 'client' / '_next'
    new_client = staging / 'dist' / 'client' / '_next'
    if old_client.is_dir():
        for path in old_client.rglob('*'):
            if not path.is_file():
                continue
            relative_name = path.relative_to(base_app)
            destination = staging / relative_name
            if destination.exists():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(path, destination)
                kept += 1
            except OSError:
                pass

    missing = [name for name in pending if not (staging / name).is_file()]
    if missing:
        fail('DELTA_INCOMPLETE', 'delta is missing %d files, first: %s' % (len(missing), missing[0]))

    bad = []
    for name, record in files.items():
        path = staging / name
        if not path.is_file() or path.stat().st_size != record['bytes'] or digest(path) != record['sha256']:
            bad.append(name)
    if bad:
        fail('VERIFY_FAILED', 'release verification failed for %d files, first: %s' % (len(bad), bad[0]))

    subprocess.run(['chown', '-R', OWNER + ':' + OWNER, str(staging)], check=True)
    staging.rename(app)

    backup_dir = ROOT / 'shared' / 'backups' / ('web-' + options.release)
    backup_dir.mkdir(parents=True, exist_ok=True)
    database = pathlib.Path('/srv/sites/jigsaw/shared/puzzle.sqlite')
    if database.is_file():
        source = sqlite3.connect('file:%s?mode=ro' % database, uri=True)
        target = sqlite3.connect(str(backup_dir / 'puzzle.sqlite'))
        with target:
            source.backup(target)
        target.close(); source.close()

    slot_link = ROOT / 'slots' / options.slot
    previous = os.readlink(slot_link)
    temporary = ROOT / 'slots' / (options.slot + '.tmp-' + str(os.getpid()))
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    os.symlink(str(app), temporary)
    os.replace(temporary, slot_link)

    unit = SERVICE.format(slot=options.slot)
    if not options.skip_restart:
        subprocess.run(['systemctl', 'restart', unit], check=True)
        body = health(options.slot)
        if not body:
            os.symlink(previous, temporary)
            os.replace(temporary, slot_link)
            subprocess.run(['systemctl', 'restart', unit], check=True)
            fail('HEALTH_FAILED', 'new release did not become healthy; previous release restored')

    receipt = {
        'ok': True, 'release': options.release, 'base': options.base,
        'gitCommit': manifest.get('gitCommit'), 'files': len(files),
        'linked': linked, 'extracted': extracted, 'keptOldChunks': kept, 'slot': options.slot,
        'slotTarget': str(app), 'previousSlotTarget': previous,
        'databaseBackup': str(backup_dir / 'puzzle.sqlite') if database.is_file() else None,
        'health': body if not options.skip_restart else None,
        'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    (backup_dir / 'deploy-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
