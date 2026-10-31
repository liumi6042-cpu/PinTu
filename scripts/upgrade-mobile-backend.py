"""Verified isolated mobile API upgrade. Never restores a stale database.

Only the mobile current symlink and mobile service are switched. All resources
in a code-delta are verified before reusing its original immutable public tree.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import stat
import subprocess
import tarfile
import time
import urllib.request
import zipfile
from contextlib import closing, contextmanager

BASE = pathlib.Path('/srv/sites/jigsaw-mobile-v3')
SERVICE = 'jigsaw-mobile-v3.service'
CODE_PATHS = {
    'server/h5-gateway.mjs', 'server/mobile-service.mjs', 'server/mobile-social.mjs', 'server/mobile-privacy.mjs',
    'server/mobile-collection.mjs', 'server/mobile-economy.mjs', 'server/mobile-tasks.mjs','server/mobile-retention.mjs','config/retention-rewards.json',
    'server/daily-content.mjs', 'config/social-phrases.json',
    'server/task-reward-settings.mjs', 'config/task-reward-defaults.json',
    'server/game-settings.mjs', 'config/game-settings-defaults.json',
    'server/album-content.mjs',
    'server/content-release.mjs', 'server/mobile-managed-content.mjs',
    'server/managed-daily-content.mjs', 'scripts/check-content-release.mjs',
    'lib/mobile-collection-catalog.json', 'outputs/mobile/engine.mjs', 'h5/asset-manifest.json',
    'lib/decoration-policy.mjs', 'scripts/check-artwork-revisions.mjs',
    'content/artwork-revisions.json', 'content/puzzle-catalog.json',
    'outputs/mobile/artwork.mjs', 'outputs/mobile/room-realtime.mjs', 'server/room-realtime.LICENSE.txt',
    'server/mobile-room-history.mjs', 'server/tap-preview.mjs', 'server/diagnostic-actions.mjs', 'server/guest-names.mjs',
    'lib/tap-platform-id.mjs',
    'server/mobile-events.mjs', 'server/mobile-levels.mjs', 'config/levels.json', 'server/mobile-solo-batch.mjs',
}
RELEASE_PATTERN = r'\d{8}-[a-z0-9-]{2,32}'
SHA_PATTERN = r'[a-f0-9]{64}'


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as file:
        for data in iter(lambda: file.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def safe_path(name):
    ensure(isinstance(name, str) and '\\' not in name and '\x00' not in name, 'Invalid package path')
    path = pathlib.PurePosixPath(name)
    ensure(not path.is_absolute() and str(path) == name and all(part not in ('', '.', '..') for part in path.parts), 'Unsafe package path')
    ensure(not re.search(r'(?:^|/)(?:\.git|\.env[^/]*|data|backups|node_modules)(?:/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)$', name, re.I), 'Private data in package')
    ensure(name in CODE_PATHS or name == 'release.json' or re.fullmatch(r'content/image-provenance/[a-z0-9]+(?:-[a-z0-9]+)*\.json', name) or re.fullmatch(r'public/(?:puzzles/|cosmetics/(?:assets/)?)?[a-zA-Z0-9._-]+', name), 'Unexpected package path')
    return path


def package_inventory(archive):
    """Read only regular archive members; extraction never delegates to tar/zip."""
    files = {}
    opener = zipfile.ZipFile if zipfile.is_zipfile(archive) else tarfile.open
    with opener(archive) as bundle:
        members = bundle.infolist() if isinstance(bundle, zipfile.ZipFile) else bundle.getmembers()
        ensure(len(members) <= 10000, 'Too many archive members')
        total = 0
        for member in members:
            zipped = isinstance(bundle, zipfile.ZipFile)
            name = member.filename if zipped else member.name
            directory = member.is_dir() if zipped else member.isdir()
            if directory:
                clean = name.rstrip('/')
                path = pathlib.PurePosixPath(clean)
                ensure(not path.is_absolute() and str(path) == clean and '\\' not in clean and '..' not in path.parts, 'Unsafe archive directory')
                continue
            if zipped:
                mode = member.external_attr >> 16
                ensure(not stat.S_ISLNK(mode) and (stat.S_IFMT(mode) in (0, stat.S_IFREG)), 'Archive link or device rejected')
            else:
                ensure(member.isfile(), 'Archive link or device rejected')
            safe_path(name)
            ensure(name not in files, 'Duplicate archive member')
            size = member.file_size if zipped else member.size
            ensure(0 <= size <= 1024 * 1024 * 1024, 'Archive member too large')
            total += size
            ensure(total <= 2 * 1024 * 1024 * 1024, 'Archive too large')
            files[name] = (size, member)
        ensure('release.json' in files and files['release.json'][0] <= 5 * 1024 * 1024, 'Release manifest missing or too large')
        read = lambda member: bundle.open(member) if isinstance(bundle, zipfile.ZipFile) else bundle.extractfile(member)
        with read(files['release.json'][1]) as file:
            manifest = json.load(file)
        declared = {}
        for item in manifest.get('files', []):
            safe_path(item['path'])
            ensure(item['path'] != 'release.json' and item['path'] not in declared, 'Duplicate manifest path')
            ensure(type(item.get('bytes')) is int and item['bytes'] >= 0 and re.fullmatch(SHA_PATTERN, item.get('sha256', '')), 'Invalid manifest inventory')
            declared[item['path']] = item
        delta = manifest.get('packageKind') == 'code-delta'
        payload = {name for name in declared if not (delta and name.startswith('public/'))}
        ensure(set(files) == payload | {'release.json'}, 'Archive inventory differs from manifest')
        # A set has no archive order. Backward seeks in gzip replay decompression
        # from the beginning, making a large release quadratic to verify. Keep
        # every size/hash check, but visit physical offsets monotonically.
        payload_order = sorted(payload, key=lambda name: files[name][1].header_offset if isinstance(bundle, zipfile.ZipFile) else files[name][1].offset)
        for name in payload_order:
            ensure(files[name][0] == declared[name]['bytes'], 'Archive file size mismatch: ' + name)
            with read(files[name][1]) as file:
                content_hash = hashlib.sha256()
                for data in iter(lambda: file.read(1024 * 1024), b''):
                    content_hash.update(data)
                ensure(content_hash.hexdigest() == declared[name]['sha256'], 'Archive hash mismatch: ' + name)
    return manifest, payload


def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def validated_pc_service(value):
    match = re.fullmatch(r'jigsaw-web@([1-9]\d{0,4})\.service', value)
    if not match or not 1 <= int(match.group(1)) <= 65535:
        raise argparse.ArgumentTypeError('PC service must be jigsaw-web@<valid numeric port>.service')
    return value


def fingerprint(paths, links, pc_service):
    validated_pc_service(pc_service)
    return {
        'files': {str(path): digest(path) for path in paths},
        'links': {str(path): str(path.resolve(strict=True)) for path in links},
        'services': {name: run('systemctl', 'is-active', name) for name in [pc_service, 'jigsaw-h5.service']},
    }


def verify_file(root, item):
    path = root / item['path']
    allowed = (root / 'public').resolve(strict=True) if item['path'].startswith('public/') else root.resolve(strict=True)
    ensure(allowed in path.resolve(strict=True).parents, 'Runtime path escapes its authorized directory')
    ensure(path.is_file() and not path.is_symlink(), 'Runtime file missing or linked: ' + item['path'])
    ensure(path.stat().st_size == item['bytes'] and digest(path) == item['sha256'], 'Runtime inventory mismatch: ' + item['path'])


def resource_file(root, item):
    """Resolve a declared immutable asset without traversing links or devices."""
    name = safe_path(item['path'])
    ensure(name.parts[0] == 'public', 'Only public resources may be hard-linked')
    ensure(root.is_absolute() and root.resolve(strict=True) == root, 'Resource root is not canonical')
    cursor = root
    for index, part in enumerate(('',) + name.parts[1:]):
        if part:
            cursor = cursor / part
        info = cursor.lstat()
        ensure(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)), 'Linked resource path rejected: ' + item['path'])
        final = index == len(name.parts) - 1
        ensure(stat.S_ISREG(info.st_mode) if final else stat.S_ISDIR(info.st_mode), 'Special or invalid resource path: ' + item['path'])
    ensure(root in cursor.resolve(strict=True).parents, 'Resource path escapes verified tree')
    return cursor


def link_verified_resources(resource_tree, target, assets):
    """A real public tree satisfies artwork validation; only assets share inodes.

    Never chmod or write these immutable links: their source release shares the
    inode. Runtime databases, configurations and code are never linked here.
    """
    ensure(target.is_absolute() and target.resolve(strict=True) == target and target.is_dir(), 'New release directory is not canonical')
    sources = []
    for item in assets:
        source = resource_file(resource_tree, item)
        ensure(source.stat().st_size == item['bytes'] and digest(source) == item['sha256'], 'Resource inventory mismatch: ' + item['path'])
        sources.append((item, source))
    public = target / 'public'
    ensure(not public.exists() and not public.is_symlink(), 'New release public tree must not exist')
    public.mkdir(mode=0o755)
    for item, source in sources:
        relative = safe_path(item['path']).relative_to('public')
        destination = public / relative
        ensure(public in destination.parents, 'Resource target escapes new public tree')
        destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        # Recheck every target ancestor, including pre-existing directories.
        cursor = public
        for part in relative.parts[:-1]:
            cursor = cursor / part
            info = cursor.lstat()
            ensure(stat.S_ISDIR(info.st_mode) and not cursor.is_symlink() and cursor.resolve(strict=True) == cursor, 'Linked resource target directory rejected')
        source = resource_file(resource_tree, item)
        os.link(source, destination, follow_symlinks=False)
        current_source = resource_file(resource_tree, item).stat()
        linked = destination.lstat()
        ensure(stat.S_ISREG(linked.st_mode) and (linked.st_dev, linked.st_ino) == (current_source.st_dev, current_source.st_ino), 'Resource hard link identity mismatch')
        ensure(linked.st_size == item['bytes'] and digest(destination) == item['sha256'], 'Linked resource inventory mismatch: ' + item['path'])


def extract_regular_files(archive, target):
    opener = zipfile.ZipFile if zipfile.is_zipfile(archive) else tarfile.open
    with opener(archive) as bundle:
        if isinstance(bundle, zipfile.ZipFile):
            entries = [(item.filename, item, item.is_dir()) for item in bundle.infolist()]
            read = bundle.open
        else:
            entries = [(item.name, item, item.isdir()) for item in bundle.getmembers()]
            read = bundle.extractfile
        for name, item, directory in entries:
            if directory:
                continue
            destination = target / safe_path(name)
            ensure(target in destination.resolve().parents, 'Extraction escapes new release')
            destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with read(item) as source, destination.open('xb') as output:
                shutil.copyfileobj(source, output)
            destination.chmod(0o644)


def online_backups(shared, folder):
    # Only the live databases at the top of shared/. Snapshots in operations/ and backups/ are backups already; copying
    # them too filled the disk on 2026-10-30 (about 5 GB of release snapshots) and took the service down.
    databases = sorted(path for path in shared.glob('*') if path.is_file() and path.suffix in ('.sqlite', '.sqlite3', '.db'))
    ensure(shared / 'mobile-v3.sqlite' in databases and shared / 'sessions.sqlite' in databases, 'Expected persistent mobile/session databases missing')
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    records = []
    for source in databases:
        ensure(not source.is_symlink() and shared in source.resolve().parents, 'Database path escapes shared storage')
        destination = folder / source.relative_to(shared)
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        # VACUUM INTO copies one consistent read snapshot; the page-by-page online backup restarts whenever the
        # busy live database is written to and never finished on the 1.5 GB mobile-v3.sqlite (2026-10-30).
        ensure(not destination.exists(), 'Backup destination exists: ' + str(destination))
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=30)) as original:
            original.execute('VACUUM INTO ?', (str(destination),))
        with closing(sqlite3.connect(destination.as_uri() + '?mode=ro', uri=True, timeout=30)) as backup:
            ensure(backup.execute('PRAGMA quick_check').fetchone() == ('ok',), 'SQLite backup verification failed')
        destination.chmod(0o600)
        records.append({'path': str(destination.relative_to(shared)), 'sha256': digest(destination), 'bytes': destination.stat().st_size})
    return records


def switch_current(base, destination, name):
    temporary = base / ('.current-' + name)
    ensure(not temporary.exists() and not temporary.is_symlink(), 'Temporary current link exists')
    temporary.symlink_to(destination, target_is_directory=True)
    os.replace(temporary, base / 'current')


def json_get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=15) as response:
        ensure(response.status == 200, 'Health response failed')
        return json.load(response)


@contextmanager
def upgrade_lock(base):
    import fcntl
    descriptor = os.open(base, os.O_RDONLY | os.O_DIRECTORY)
    try:
        # Lock the existing directory inode; even --check-only creates no file.
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--expect-current', required=True)
    parser.add_argument('--pc-service', type=validated_pc_service, default='jigsaw-web@3104.service', help='Current protected PC service; only a valid jigsaw-web@<port>.service is accepted')
    parser.add_argument('--check-only', action='store_true', help='Verify host/archive/resources without writing, switching or restarting')
    args = parser.parse_args()
    ensure(re.fullmatch(RELEASE_PATTERN, args.release) and re.fullmatch(RELEASE_PATTERN, args.expect_current), 'Invalid release identifier')
    ensure(re.fullmatch(SHA_PATTERN, args.sha256), 'Invalid archive digest')
    ensure(os.geteuid() == 0 and BASE.resolve() == BASE and BASE.is_dir(), 'Run on the established mobile production host as root')
    # One upgrade at a time. Import only on the production POSIX execution path.
    with upgrade_lock(BASE):
        current = BASE / 'current'
        old = current.resolve(strict=True)
        ensure(current.is_symlink() and old == BASE / 'releases' / args.expect_current and old.is_dir(), 'Unexpected current mobile release')
        target = BASE / 'releases' / args.release
        ensure(not target.exists() and not target.is_symlink() and target.parent.resolve() == BASE / 'releases', 'New release must be a fresh directory')
        shared = BASE / 'shared'
        ensure(shared.is_dir() and shared.resolve() == shared, 'Shared data directory is unexpected')
        archive = pathlib.Path(args.archive).resolve(strict=True)
        ensure(archive.is_file() and digest(archive) == args.sha256, 'Archive SHA256 mismatch')
        manifest, payload = package_inventory(archive)
        ensure(manifest.get('service') == 'jigsaw-mobile-v3' and manifest.get('release') == args.release and manifest.get('frontendIncluded') is False and manifest.get('backendMode') == 'mobile-v3-isolated', 'Wrong release manifest')
        if manifest.get('baseRelease') and manifest.get('packageKind') != 'code-delta':
            ensure(manifest['baseRelease'] == args.expect_current and digest(old / 'release.json') == manifest.get('baseManifestSha256'), 'Full package baseline differs from installed release')
        ensure({'server/h5-gateway.mjs', 'server/mobile-service.mjs', 'outputs/mobile/engine.mjs', 'h5/asset-manifest.json'} <= payload, 'Required runtime entry missing')
        ensure(run('/usr/local/bin/node', '--version').startswith('v24.'), 'Unexpected production Node runtime')
        ensure(run('systemctl', 'is-active', SERVICE) == 'active', 'Mobile service must be active before upgrade')
        protected = [pathlib.Path(name) for name in ['/etc/systemd/system/jigsaw-web@.service', '/etc/systemd/system/jigsaw-h5.service', '/etc/systemd/system/jigsaw-mobile-v3.service', '/etc/webapps/jigsaw-mobile-v3.env', '/etc/nginx/sites-enabled/jigsawnook.online.conf']]
        links = [pathlib.Path('/srv/sites/jigsaw/current'), pathlib.Path('/srv/sites/jigsaw-h5/current')]
        before = fingerprint(protected, links, args.pc_service)
        ensure(all(value == 'active' for value in before['services'].values()), 'PC or legacy H5 is not active')
        assets = [item for item in manifest['files'] if item['path'].startswith('public/')]
        ensure(len(assets) == manifest.get('assetCount') and assets, 'Invalid resource count')
        resource_tree = None
        resource_release = None
        if manifest.get('packageKind') == 'code-delta':
            ensure(manifest.get('baseRelease') == args.expect_current and digest(old / 'release.json') == manifest.get('baseManifestSha256'), 'Delta baseline differs from installed release')
            previous = json.loads((old / 'release.json').read_text())
            previous_assets = {item['path']: item for item in previous['files'] if item['path'].startswith('public/')}
            ensure(previous_assets == {item['path']: item for item in assets}, 'Delta changes runtime resources; a full package is required')
            resource_tree = (old / 'public').resolve(strict=True)
            resource_release = resource_tree.parent.name
            ensure(re.fullmatch(RELEASE_PATTERN, resource_release) and resource_tree == BASE / 'releases' / resource_release / 'public' and resource_tree.is_dir(), 'Baseline public resources must resolve to a mobile release public directory')
            for item in assets:
                verify_file(old, item)
                resource_file(resource_tree, item)
        else:
            ensure(manifest.get('packageKind') in (None, 'full'), 'Unknown package kind')
        preview = {'release': args.release, 'previousRelease': args.expect_current, 'archiveSha256': args.sha256, 'packageKind': manifest.get('packageKind', 'full'), 'payloadFiles': len(payload), 'resourceCount': len(assets), 'pcService': args.pc_service, 'checkOnly': args.check_only}
        if args.check_only:
            ensure(fingerprint(protected, links, args.pc_service) == before and current.resolve() == old, 'Protected host state changed during check')
            print(json.dumps(preview))
            return
        target.mkdir(mode=0o755)
        extract_regular_files(archive, target)
        if manifest.get('packageKind') == 'code-delta':
            link_verified_resources(resource_tree, target, assets)
        for item in manifest['files']:
            verify_file(target, item)
        if manifest.get('artworkOverlay'):
            overlay = json.loads(run('/usr/local/bin/node', str(target / 'scripts/check-artwork-revisions.mjs')))
            ensure(overlay.get('activeImages') == manifest['artworkOverlay'].get('activeImages') and overlay.get('overlayFiles') == manifest['artworkOverlay'].get('files'), 'Artwork overlay inventory mismatch')
        ensure(digest(archive) == args.sha256, 'Archive changed during preparation')
        record = target / 'deployment'
        record.mkdir(mode=0o700)
        records = online_backups(shared, shared / 'backups' / ('upgrade-' + args.release))
        backup_record = {'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'databases': records, 'strategy': 'sqlite-online-backup; rollback keeps current shared data'}
        (record / 'backup.json').write_text(json.dumps(backup_record, indent=2) + '\n')
        (record / 'backup.json').chmod(0o600)
        ensure(fingerprint(protected, links, args.pc_service) == before and current.resolve() == old, 'Host changed before mobile switch')
        switched = False
        try:
            switch_current(BASE, target, args.release)
            switched = True
            run('systemctl', 'restart', SERVICE)
            # Up to 60 s: a release that adds an index builds it at startup, which on the 1.5 GB live database
            # took longer than the former 10 s (2026-10-30).
            for attempt in range(240):
                try:
                    ensure(json_get('http://127.0.0.1:3292/healthz').get('mode') == 'mobile-v3-isolated', 'Unexpected health mode')
                    break
                except Exception:
                    if attempt == 239:
                        raise
                    time.sleep(.25)
            config = json_get('http://127.0.0.1:3292/h5/config')
            ensure(config.get('mobileMode') == 'mobile-v3-isolated', 'Mobile config verification failed')
            sample = next(item for item in assets if re.search(r'-thumbnail-[a-f0-9]{12}\.webp$', item['path']))
            with urllib.request.urlopen('http://127.0.0.1:3292/h5/assets/' + sample['path'][7:], timeout=15) as response:
                ensure(response.status == 200 and hashlib.sha256(response.read()).hexdigest() == sample['sha256'], 'Resource smoke check failed')
            ensure(run('systemctl', 'is-active', SERVICE) == 'active', 'Mobile service is not active')
            ensure(fingerprint(protected, links, args.pc_service) == before, 'Protected PC/H5/config files changed')
            result = {**preview, 'active': True, 'backupCount': len(records), 'sharedDataPreserved': True, 'pcAndLegacyUnchanged': True, 'frontendDeployed': False, 'publicResourceDependency': resource_release}
            (record / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            (record / 'result.json').chmod(0o600)
            print(json.dumps(result))
        except Exception:
            if switched:
                switch_current(BASE, old, args.release + '-rollback')
                run('systemctl', 'restart', SERVICE)
            (record / 'rollback.json').write_text(json.dumps({'currentRelease': args.expect_current, 'sharedDataRestoredFromBackup': False, 'reason': 'post-switch verification failed'}) + '\n')
            (record / 'rollback.json').chmod(0o600)
            raise


if __name__ == '__main__':
    main()
