"""Freeze a clean-source, hash-verified runtime as an incremental transfer only.

No network, production data, service commands or full-artwork recompression.
The normal Linux rebuilder still revalidates every omitted installed file.
"""
import argparse, hashlib, importlib.util, io, json, pathlib, subprocess, tarfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2] / 'work' / 'dual-managed-release-20261014'
spec = importlib.util.spec_from_file_location('sparse_rules', ROOT / 'work/web-sparse-transfer-20261015/prepare-web-sparse.py')
rules = importlib.util.module_from_spec(spec); spec.loader.exec_module(rules)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, encoding='utf-8').strip()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--base-release', required=True)
    args = parser.parse_args()
    rules.ensure(git('rev-parse', 'HEAD') == args.commit and not git('status', '--porcelain'), 'Expected the reviewed, clean final source commit')
    prepared = json.loads((HERE / 'runtime-preparation.json').read_text(encoding='utf-8'))
    smoke_bytes = (HERE / 'runtime-smoke.json').read_bytes(); smoke = json.loads(smoke_bytes)
    rules.ensure(smoke['ok'] is True and smoke['sourceInventorySha256'] == prepared['sourceInventorySha256'], 'This precise prepared runtime must pass focused smoke first')
    for item in prepared['sourceFiles']:
        rules.ensure(rules.digest(ROOT / rules.safe_path(item['path'])) == item['sha256'], 'Source changed after build: ' + item['path'])
    current_names = set(git('ls-files', '-z').split('\0')) - {''}
    rules.ensure(current_names == {item['path'] for item in prepared['sourceFiles']}, 'Build input file list differs from the committed tree')
    target = {**prepared['runtime'], 'gitCommit': args.commit, 'dirty': False,
              'sourceInventorySha256': prepared['sourceInventorySha256'],
              'verification': {'kind': 'focused-runtime-http-and-file-validation', 'recordSha256': hashlib.sha256(smoke_bytes).hexdigest()}}
    files = rules.inventory(target); app = pathlib.Path(prepared['output'])
    for name, record in files.items():
        path = app / name
        rules.ensure(path.is_file() and not path.is_symlink() and path.stat().st_size == record['bytes'] and rules.digest(path) == record['sha256'], 'Prepared runtime changed: ' + name)
    target_bytes = (json.dumps(target, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    baseline_bytes = (HERE / 'baseline-manifest.json').read_bytes(); baseline = json.loads(baseline_bytes); old = rules.inventory(baseline)
    payload = sorted(name for name, record in files.items() if old.get(name) != record)
    descriptor = {'schema': 'jigsaw-web-sparse-transfer/v1', 'baseRelease': args.base_release,
        'baseGitCommit': baseline['gitCommit'], 'baseManifestDigest': rules.canonical_digest(baseline),
        'baseManifestSha256': hashlib.sha256(baseline_bytes).hexdigest(),
        'baseManifestEvidence': 'raw currently installed manifest downloaded read-only before preparation; server must verify again',
        'targetGitCommit': args.commit, 'manifestSha256': hashlib.sha256(target_bytes).hexdigest(),
        'payload': payload, 'reusedFiles': len(files) - len(payload), 'modes': {name: 0o644 for name in files},
        'originalFullArchiveCreated': False, 'focusedRuntimeSmokeSha256': hashlib.sha256(smoke_bytes).hexdigest()}
    archive = HERE / 'web-performance-sparse.tar.gz'
    rules.ensure(not archive.exists(), 'Refusing to overwrite a frozen transfer archive')
    descriptor_bytes = (json.dumps(descriptor, sort_keys=True, indent=2) + '\n').encode('utf-8')
    with tarfile.open(archive, 'w:gz', compresslevel=1) as output:
        for name in payload:
            record = files[name]; info = tarfile.TarInfo(name); info.mode = 0o644; info.size = record['bytes']; info.mtime = 0
            with (app / name).open('rb') as body: output.addfile(info, body)
        for name, body in [('release.json', target_bytes), ('sparse-transfer.json', descriptor_bytes)]:
            info = tarfile.TarInfo(name); info.mode = 0o644; info.size = len(body); info.mtime = 0; output.addfile(info, io.BytesIO(body))
    seen = set()
    with tarfile.open(archive, 'r:gz') as check:
        for member in check:
            name = rules.safe_path(member.name); rules.ensure(member.isfile() and name not in seen, 'Invalid frozen sparse member'); seen.add(name)
            expected = files.get(name) if name not in ['release.json','sparse-transfer.json'] else {'bytes': len(target_bytes if name == 'release.json' else descriptor_bytes), 'sha256': hashlib.sha256(target_bytes if name == 'release.json' else descriptor_bytes).hexdigest()}
            body = check.extractfile(member).read(); rules.ensure(len(body) == expected['bytes'] and hashlib.sha256(body).hexdigest() == expected['sha256'], 'Frozen sparse bytes differ: ' + name)
    rules.ensure(seen == set(payload) | {'release.json', 'sparse-transfer.json'}, 'Sparse frozen inventory incomplete')
    rules.ensure(git('rev-parse','HEAD') == args.commit and not git('status','--porcelain'), 'Source changed while freezing')
    (HERE / 'target-manifest.json').write_bytes(target_bytes); (HERE / 'sparse-transfer.json').write_bytes(descriptor_bytes)
    (app / 'release.json').write_bytes(target_bytes)
    report = {'schema':'jigsaw-web-performance-prepared/v1', 'preparedOnly':True, 'uploaded':False, 'deployed':False,
        'sourceCommit':args.commit, 'sourceInventorySha256':prepared['sourceInventorySha256'], 'sourceClean':True,
        'archive':str(archive), 'sha256':rules.digest(archive), 'bytes':archive.stat().st_size,
        'targetManifestSha256':descriptor['manifestSha256'], 'baseRelease':args.base_release, 'baseGitCommit':baseline['gitCommit'],
        'baseManifestSha256':descriptor['baseManifestSha256'], 'baseManifestDigest':descriptor['baseManifestDigest'],
        'targetFiles':len(files), 'runtimeAssets':len(target['runtimeAssets']), 'runtimeBytes':sum(file['bytes'] for file in files.values()),
        'transferredFiles':len(payload), 'reusedFiles':descriptor['reusedFiles'], 'payloadBytes':sum(files[name]['bytes'] for name in payload),
        'fullArchiveCreatedLocally':False, 'fullRuntimeSmoke':smoke, 'nginxConfigurationIncluded':False, 'CDNChanged':False,
        'requiresRemoteRebuildAndAcceptance':True}
    (HERE / 'preparation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__ == '__main__': main()
