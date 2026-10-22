"""Rebuild a complete verified API archive in /tmp; never switch or stop a service."""
import argparse
import errno
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import tarfile
import tempfile

BASE = pathlib.Path('/srv/sites/jigsaw-mobile-v3')


def ensure(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as file:
        for data in iter(lambda: file.read(1024 * 1024), b''):
            result.update(data)
    return result.hexdigest()


def validator(path):
    spec = importlib.util.spec_from_file_location('mobile_full_validator', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_file(baseline, name):
    path = baseline / name
    # A previous code-only release may reuse its original immutable public tree.
    allowed = (baseline / 'public').resolve(strict=True) if name.startswith('public/') else baseline
    actual = path.resolve(strict=True)
    ensure(path.is_file() and not path.is_symlink() and allowed in actual.parents, 'Missing or unsafe exact baseline file: ' + name)
    return actual


def rebuild(archive, output, baseline, temp_parent, expected_sha, expected_current, check):
    ensure(archive.is_file() and digest(archive) == expected_sha, 'Sparse archive SHA256 mismatch')
    ensure(not output.exists() and not output.is_symlink(), 'Refusing to overwrite a prepared full archive')
    baseline = baseline.resolve(strict=True)
    before_bytes = (baseline / 'release.json').read_bytes()
    before = json.loads(before_bytes)
    ensure(before.get('release') == expected_current, 'Wrong installed baseline release')
    old = {file['path']: file for file in before.get('files', [])}
    ensure(len(old) == len(before.get('files', [])), 'Duplicate baseline file declaration')
    with tarfile.open(archive, 'r:gz') as bundle:
        members = {}
        total = 0
        for item in bundle.getmembers():
            ensure(item.isfile() and not item.issym() and not item.islnk(), 'Sparse transfer contains a directory, link or device')
            ensure(item.name not in members, 'Duplicate sparse transfer member')
            if item.name != 'sparse-transfer.json':
                check.safe_path(item.name)
            ensure(0 <= item.size <= 1024 * 1024 * 1024, 'Sparse member size is invalid')
            total += item.size
            ensure(total <= 2 * 1024 * 1024 * 1024 and len(members) < 10000, 'Sparse transfer is too large')
            members[item.name] = item
        ensure({'sparse-transfer.json', 'release.json'} <= members.keys(), 'Sparse descriptors missing')
        ensure(members['sparse-transfer.json'].size <= 5 * 1024 * 1024 and members['release.json'].size <= 5 * 1024 * 1024, 'Sparse descriptor too large')
        descriptor = json.load(bundle.extractfile(members['sparse-transfer.json']))
        target_bytes = bundle.extractfile(members['release.json']).read()
        target = json.loads(target_bytes)
        ensure(descriptor.get('schema') == 'jigsaw-mobile-sparse-transfer/v1', 'Wrong sparse transfer schema')
        ensure(descriptor.get('baseRelease') == expected_current and descriptor.get('baseManifestSha256') == hashlib.sha256(before_bytes).hexdigest(), 'Installed baseline manifest differs')
        ensure(descriptor.get('manifestSha256') == hashlib.sha256(target_bytes).hexdigest(), 'Target manifest digest mismatch')
        ensure(target.get('service') == 'jigsaw-mobile-v3' and target.get('backendMode') == 'mobile-v3-isolated' and target.get('packageKind') == 'full' and target.get('frontendIncluded') is False, 'Wrong target API manifest')
        ensure(target.get('release') == descriptor.get('release') and re.fullmatch(check.RELEASE_PATTERN, target.get('release', '')), 'Wrong target release')
        ensure(target.get('baseRelease') == expected_current and target.get('baseManifestSha256') == descriptor.get('baseManifestSha256'), 'Target baseline declaration differs')
        files = {}
        for file in target.get('files', []):
            check.safe_path(file['path'])
            ensure(file['path'] != 'release.json' and file['path'] not in files, 'Duplicate target path')
            ensure(type(file.get('bytes')) is int and 0 <= file['bytes'] <= 1024 * 1024 * 1024 and re.fullmatch(check.SHA_PATTERN, file.get('sha256', '')), 'Invalid target file declaration')
            files[file['path']] = file
        ensure(0 < len(files) <= 10000 and sum(file['bytes'] for file in files.values()) <= 2 * 1024 * 1024 * 1024, 'Complete target inventory is too large')
        payload = {name for name, file in files.items() if old.get(name) != file}
        ensure(set(members) == payload | {'sparse-transfer.json', 'release.json'}, 'Sparse payload is incomplete or has extra files')
        ensure(isinstance(descriptor.get('payload'), list) and len(descriptor['payload']) == len(payload) and set(descriptor['payload']) == payload, 'Sparse payload declaration differs')
        reused = set(files) - payload
        ensure(descriptor.get('reusedFiles') == len(reused), 'Sparse reuse count differs')
        sources = {}
        for name in sorted(reused):
            file = files[name]
            actual = source_file(baseline, name)
            ensure(actual.stat().st_size == file['bytes'] and digest(actual) == file['sha256'], 'Exact installed baseline file hash differs: ' + name)
            sources[name] = actual
        with tempfile.TemporaryDirectory(prefix='jigsaw-mobile-full-', dir=temp_parent) as temporary:
            stage = pathlib.Path(temporary).resolve()
            ensure(stage.parent == temp_parent.resolve(), 'Unexpected temporary output root')
            # Read sparse entries in physical gzip order, retaining all file hashes.
            for name in sorted(payload, key=lambda name: members[name].offset):
                item, file = members[name], files[name]
                ensure(item.size == file['bytes'], 'Sparse member size differs: ' + name)
                destination = stage / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(item) as source, destination.open('xb') as target_file:
                    shutil.copyfileobj(source, target_file)
                ensure(digest(destination) == file['sha256'], 'Sparse member hash differs: ' + name)
            for name, source in sources.items():
                destination = stage / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                try:
                    os.link(source, destination, follow_symlinks=False)
                except OSError as error:
                    if error.errno not in (errno.EXDEV, errno.EPERM, errno.EACCES, errno.ENOTSUP):
                        raise
                    with source.open('rb') as source_file_handle, destination.open('xb') as target_file:
                        shutil.copyfileobj(source_file_handle, target_file)
            (stage / 'release.json').write_bytes(target_bytes)
            for name, file in files.items():
                target_file = stage / name
                ensure(target_file.is_file() and target_file.stat().st_size == file['bytes'] and digest(target_file) == file['sha256'], 'Rebuilt complete target file differs: ' + name)
            partial = output.with_name(output.name + '.partial')
            ensure(not partial.exists() and not partial.is_symlink(), 'Partial output already exists')
            partial_created = False
            try:
                with partial.open('xb') as output_file:
                    partial_created = True
                    with tarfile.open(fileobj=output_file, mode='w:gz', compresslevel=1) as rebuilt:
                        for name in [*files, 'release.json']:
                            path = stage / name
                            info = tarfile.TarInfo(name)
                            info.size = path.stat().st_size
                            info.mode = 0o644
                            info.mtime = 0
                            with path.open('rb') as content:
                                rebuilt.addfile(info, content)
                verified, inventory = check.package_inventory(partial)
                ensure(verified == target and inventory == set(files), 'Rebuilt complete archive verification differs')
                os.replace(partial, output)
            finally:
                if partial_created and partial.exists():
                    partial.unlink()
    ensure((baseline / 'release.json').read_bytes() == before_bytes, 'Installed baseline changed during reconstruction')
    return {'release': target['release'], 'archive': str(output), 'sha256': digest(output), 'bytes': output.stat().st_size, 'manifestSha256': hashlib.sha256(target_bytes).hexdigest(), 'verifiedFiles': len(files), 'reusedFiles': len(reused), 'transferredFiles': len(payload), 'servicesChanged': False, 'currentChanged': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--expect-current', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--validator', required=True)
    args = parser.parse_args()
    check = validator(pathlib.Path(args.validator).resolve(strict=True))
    ensure(re.fullmatch(check.SHA_PATTERN, args.sha256) and re.fullmatch(check.RELEASE_PATTERN, args.expect_current), 'Invalid requested SHA256 or release')
    ensure(BASE.is_dir() and BASE.resolve() == BASE, 'Unexpected mobile installation root')
    current = BASE / 'current'
    baseline = current.resolve(strict=True)
    ensure(current.is_symlink() and baseline == BASE / 'releases' / args.expect_current, 'Unexpected current mobile release')
    public = (baseline / 'public').resolve(strict=True)
    ensure(public.name == 'public' and public.parent.parent == BASE / 'releases' and re.fullmatch(check.RELEASE_PATTERN, public.parent.name), 'Unexpected immutable public resource dependency')
    output = pathlib.Path(args.output).resolve()
    ensure(output.parent == pathlib.Path('/tmp') and re.fullmatch(r'jigsaw-mobile-backend-\d{8}-[a-z0-9-]{2,32}-rebuilt\.tar\.gz', output.name), 'Full output must be a new named archive under /tmp')
    with check.upgrade_lock(BASE):
        result = rebuild(pathlib.Path(args.archive).resolve(strict=True), output, baseline, pathlib.Path('/tmp'), args.sha256, args.expect_current, check)
        ensure(current.resolve() == baseline, 'Current mobile release changed during reconstruction')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
