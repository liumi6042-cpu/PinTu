"""Rebuild a complete Web archive under /tmp using exact installed file hashes. Never deploy."""
import argparse, errno, hashlib, io, json, os, pathlib, re, shutil, tarfile, tempfile

BASE = pathlib.Path('/srv/sites/jigsaw')
SHA = re.compile(r'[a-f0-9]{64}')

def ensure(value, message):
    if not value: raise RuntimeError(message)

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''): value.update(chunk)
    return value.hexdigest()

def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()

def safe_path(name):
    ensure(isinstance(name, str) and 0 < len(name) < 1000 and '\\' not in name and ':' not in name and not any(ord(c) < 32 for c in name), 'Unsafe release path')
    path = pathlib.PurePosixPath(name)
    ensure(not path.is_absolute() and str(path) == name and all(part not in ('', '.', '..') for part in path.parts), 'Release path escapes its root')
    ensure(not any(part.startswith(('.env', '.dev.vars')) or part in ('.git', '.aws') for part in path.parts), 'Private file in release')
    ensure(not re.search(r'\.(?:sqlite(?:-\w+)?|db|pem|key|pfx|p12)$', name, re.I), 'Private data in release')
    return name

def inventory(manifest):
    ensure(manifest.get('app') == 'jigsaw-nook' and manifest.get('schema') == 1 and manifest.get('dirty') is False and re.fullmatch(r'[a-f0-9]{40}', manifest.get('gitCommit', '')), 'Not a clean Web manifest')
    output = {}
    for file in manifest.get('files', []):
        name = safe_path(file['path'])
        ensure(name not in ('release.json', 'sparse-transfer.json') and name not in output, 'Duplicate/reserved path')
        ensure(type(file.get('bytes')) is int and 0 <= file['bytes'] <= 1024**3 and SHA.fullmatch(file.get('sha256', '')), 'Invalid target inventory')
        output[name] = file
    ensure(0 < len(output) < 30000 and sum(file['bytes'] for file in output.values()) < 4 * 1024**3, 'Target inventory too large')
    return output

def baseline_file(root, name, record):
    path = root / safe_path(name); actual = path.resolve(strict=True)
    ensure(actual == path and root in actual.parents and path.is_file() and not path.is_symlink(), 'Unsafe installed baseline file: ' + name)
    ensure(path.stat().st_size == record['bytes'] and digest(path) == record['sha256'], 'Installed baseline file hash differs: ' + name)
    return path

def rebuild(archive, sparse_sha, baseline, expected_release, expected_commit, output_root, current=None, expected_manifest_sha=None):
    ensure(SHA.fullmatch(sparse_sha) and archive.is_file() and digest(archive) == sparse_sha, 'Sparse archive SHA256 differs')
    baseline = baseline.resolve(strict=True); before = (baseline / 'release.json').read_bytes(); old_manifest = json.loads(before); old = inventory(old_manifest)
    ensure(old_manifest['gitCommit'] == expected_commit, 'Installed baseline commit differs')
    if expected_manifest_sha: ensure(hashlib.sha256(before).hexdigest() == expected_manifest_sha, 'Installed raw manifest SHA256 differs')
    with tarfile.open(archive, 'r:gz') as bundle:
        members = {}; total = 0
        for item in bundle.getmembers():
            ensure(item.isfile() and not item.issym() and not item.islnk(), 'Sparse links/directories/devices forbidden')
            name = safe_path(item.name); ensure(name not in members, 'Duplicate sparse member'); total += item.size
            ensure(0 <= item.size <= 1024**3 and total < 4 * 1024**3 and len(members) < 30002, 'Sparse archive too large')
            members[name] = item
        ensure({'release.json', 'sparse-transfer.json'} <= set(members), 'Sparse descriptors missing')
        ensure(members['release.json'].size <= 5 * 1024**2 and members['sparse-transfer.json'].size <= 10 * 1024**2, 'Sparse descriptor too large')
        target_bytes = bundle.extractfile(members['release.json']).read(); target = json.loads(target_bytes); files = inventory(target)
        descriptor = json.load(bundle.extractfile(members['sparse-transfer.json']))
        ensure(descriptor.get('schema') == 'jigsaw-web-sparse-transfer/v1', 'Wrong sparse schema')
        ensure(descriptor.get('baseRelease') == expected_release and descriptor.get('baseGitCommit') == expected_commit, 'Sparse baseline declaration differs')
        ensure(descriptor.get('baseManifestDigest') == canonical_digest(old_manifest), 'Installed complete baseline manifest differs')
        ensure(descriptor.get('targetGitCommit') == target['gitCommit'] and descriptor.get('manifestSha256') == hashlib.sha256(target_bytes).hexdigest(), 'Target manifest differs')
        payload = {name for name, file in files.items() if old.get(name) != file}; reused = set(files) - payload
        ensure(set(members) == payload | {'release.json', 'sparse-transfer.json'}, 'Sparse payload incomplete or contains extra files')
        ensure(isinstance(descriptor.get('payload'), list) and len(descriptor['payload']) == len(payload) and set(descriptor['payload']) == payload and descriptor.get('reusedFiles') == len(reused), 'Sparse payload declaration differs')
        modes = descriptor.get('modes', {})
        ensure(set(modes) == set(files) and all(type(mode) is int and 0 <= mode <= 0o777 for mode in modes.values()), 'Invalid target file modes')
        sources = {name: baseline_file(baseline, name, files[name]) for name in sorted(reused)}
        with tempfile.TemporaryDirectory(prefix='jigsaw-web-rebuild-', dir=output_root) as temporary:
            stage = pathlib.Path(temporary); data = stage / 'files'; data.mkdir()
            for name in sorted(payload, key=lambda name: members[name].offset):
                member = members[name]; file = files[name]; ensure(member.size == file['bytes'], 'Sparse member size differs')
                destination = data / name; destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, destination.open('xb') as output: shutil.copyfileobj(source, output)
                ensure(digest(destination) == file['sha256'], 'Changed file hash differs: ' + name); sources[name] = destination
            for name in reused:
                source = sources[name]; destination = data / name; destination.parent.mkdir(parents=True, exist_ok=True)
                try: os.link(source, destination, follow_symlinks=False)
                except OSError as error:
                    if error.errno not in (errno.EXDEV, errno.EPERM, errno.EACCES, errno.ENOTSUP): raise
                    with source.open('rb') as original, destination.open('xb') as output: shutil.copyfileobj(original, output)
                sources[name] = destination
            rebuilt = stage / 'complete.tar.gz'
            with tarfile.open(rebuilt, 'w:gz', compresslevel=1) as complete:
                for name in sorted(files):
                    file = files[name]; source = sources[name]
                    ensure(source.stat().st_size == file['bytes'] and digest(source) == file['sha256'], 'Rebuilt file differs: ' + name)
                    info = tarfile.TarInfo(name); info.size = file['bytes']; info.mode = modes[name]; info.mtime = 0
                    with source.open('rb') as content: complete.addfile(info, content)
                info = tarfile.TarInfo('release.json'); info.size = len(target_bytes); info.mode = 0o644; info.mtime = 0
                complete.addfile(info, io.BytesIO(target_bytes))
            # Re-read the archive, validating actual packed bytes rather than only the staging files.
            seen = set()
            with tarfile.open(rebuilt, 'r|gz') as verified:
                for member in verified:
                    name = safe_path(member.name); ensure(member.isfile() and name not in seen, 'Invalid rebuilt member'); seen.add(name)
                    body = verified.extractfile(member)
                    value = hashlib.sha256(); count = 0
                    for chunk in iter(lambda: body.read(1024 * 1024), b''): count += len(chunk); value.update(chunk)
                    expected = {'bytes': len(target_bytes), 'sha256': hashlib.sha256(target_bytes).hexdigest()} if name == 'release.json' else files.get(name)
                    ensure(expected and count == expected['bytes'] and value.hexdigest() == expected['sha256'], 'Complete archive file verification failed: ' + name)
            ensure(seen == set(files) | {'release.json'}, 'Rebuilt complete archive is incomplete')
            ensure((baseline / 'release.json').read_bytes() == before and (current is None or current.resolve(strict=True) == baseline), 'Current release changed during reconstruction')
            full_sha = digest(rebuilt); output = output_root / ('jigsaw-nook-' + full_sha[:16] + '.tar.gz')
            if output.exists(): ensure(output.is_file() and not output.is_symlink() and digest(output) == full_sha, 'Refusing to overwrite a prepared archive')
            else: os.link(rebuilt, output, follow_symlinks=False)
    return {'archive': str(output), 'sha256': full_sha, 'bytes': output.stat().st_size, 'gitCommit': target['gitCommit'],
        'manifestSha256': hashlib.sha256(target_bytes).hexdigest(), 'baseRelease': expected_release, 'baseManifestSha256': hashlib.sha256(before).hexdigest(),
        'verifiedFiles': len(files), 'transferredFiles': len(payload), 'reusedFiles': len(reused), 'servicesChanged': False, 'currentChanged': False,
        'note': 'Archive compression is rebuilt; pass this returned SHA256 to the existing deployment script.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'sha256', 'expect-current', 'expect-base-commit']: parser.add_argument('--' + name, required=True)
    parser.add_argument('--baseline-manifest-sha256')
    args = parser.parse_args()
    ensure(re.fullmatch(r'\d{8}-\d{2}', args.expect_current) and re.fullmatch(r'[a-f0-9]{40}', args.expect_base_commit), 'Invalid baseline identity')
    ensure(BASE.is_dir() and BASE.resolve() == BASE, 'Unexpected Web installation root')
    current = BASE / 'current'; baseline = current.resolve(strict=True)
    ensure(current.is_symlink() and baseline == BASE / 'releases' / args.expect_current / 'app', 'Unexpected current Web release')
    archive = pathlib.Path(args.archive).resolve(strict=True)
    ensure(archive.parent == pathlib.Path('/tmp') and archive.is_file(), 'Sparse input must be a file under /tmp')
    if args.baseline_manifest_sha256: ensure(SHA.fullmatch(args.baseline_manifest_sha256), 'Invalid raw baseline manifest SHA256')
    print(json.dumps(rebuild(archive, args.sha256, baseline, args.expect_current, args.expect_base_commit, pathlib.Path('/tmp'), current, args.baseline_manifest_sha256)))
