"""Exercise sparse transfer reconstruction locally, with no production access."""
import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


upgrade = load('upgrade', ROOT / 'scripts/upgrade-mobile-backend.py')
rebuild = load('rebuild', ROOT / 'scripts/rebuild-mobile-full-from-sparse.py')
sha = lambda value: hashlib.sha256(value).hexdigest()


class SparseRebuild(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'work')
        self.root = pathlib.Path(self.temporary.name)
        self.baseline = self.root / 'baseline'
        self.baseline.mkdir()
        self.old_files = {'server/mobile-service.mjs': b'old service', 'public/puzzles/old-play-0123456789ab.webp': b'old image'}
        before = {'release': '20261015-freealbums39', 'files': []}
        for name, value in self.old_files.items():
            file = self.baseline / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(value)
            before['files'].append({'path': name, 'bytes': len(value), 'sha256': sha(value)})
        self.before = (json.dumps(before) + '\n').encode()
        (self.baseline / 'release.json').write_bytes(self.before)
        changed = {'server/mobile-service.mjs': b'new service', 'public/puzzles/new-optimized-0123456789ab.webp': b'new image'}
        full = {**self.old_files, **changed}
        self.target = {'service': 'jigsaw-mobile-v3', 'backendMode': 'mobile-v3-isolated', 'packageKind': 'full', 'frontendIncluded': False, 'release': '20261015-artwork40', 'baseRelease': before['release'], 'baseManifestSha256': sha(self.before), 'files': [{'path': name, 'bytes': len(value), 'sha256': sha(value)} for name, value in full.items()]}
        target_bytes = (json.dumps(self.target) + '\n').encode()
        descriptor = {'schema': 'jigsaw-mobile-sparse-transfer/v1', 'release': self.target['release'], 'baseRelease': before['release'], 'baseManifestSha256': sha(self.before), 'manifestSha256': sha(target_bytes), 'payload': list(changed), 'reusedFiles': 1}
        self.archive = self.root / 'sparse.tar.gz'
        with tarfile.open(self.archive, 'w:gz') as bundle:
            for name, value in {'sparse-transfer.json': json.dumps(descriptor).encode(), 'release.json': target_bytes, **changed}.items():
                info = tarfile.TarInfo(name)
                info.size = len(value)
                bundle.addfile(info, io.BytesIO(value))
        self.output = self.root / 'full.tar.gz'

    def tearDown(self):
        self.temporary.cleanup()

    def run_rebuild(self):
        return rebuild.rebuild(self.archive, self.output, self.baseline, self.root, rebuild.digest(self.archive), '20261015-freealbums39', upgrade)

    def test_success_verifies_all_target_files_and_preserves_baseline(self):
        result = self.run_rebuild()
        self.assertEqual(result['verifiedFiles'], 3)
        self.assertEqual(result['reusedFiles'], 1)
        self.assertFalse(result['servicesChanged'])
        manifest, payload = upgrade.package_inventory(self.output)
        self.assertEqual(manifest, self.target)
        self.assertEqual(len(payload), 3)
        self.assertEqual((self.baseline / 'release.json').read_bytes(), self.before)
        for name, value in self.old_files.items():
            self.assertEqual((self.baseline / name).read_bytes(), value)

    def test_missing_baseline_file_fails_without_creating_full_output(self):
        (self.baseline / 'public/puzzles/old-play-0123456789ab.webp').unlink()
        with self.assertRaises((FileNotFoundError, RuntimeError)):
            self.run_rebuild()
        self.assertFalse(self.output.exists())

    def test_baseline_hash_mismatch_fails_without_creating_full_output(self):
        (self.baseline / 'public/puzzles/old-play-0123456789ab.webp').write_bytes(b'bad image')
        with self.assertRaisesRegex(RuntimeError, 'baseline file hash differs'):
            self.run_rebuild()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
