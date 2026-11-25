"""Focused local checks for the code-delta ordinary-public/hard-link fix."""
import hashlib
import importlib.util
import os
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(os.environ['MOBILE_UPGRADE_SCRIPT']) if os.environ.get('MOBILE_UPGRADE_SCRIPT') else pathlib.Path(__file__).resolve().parents[1] / 'upgrade-mobile-backend.py'
spec = importlib.util.spec_from_file_location('mobile_upgrade', SCRIPT)
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class ResourceLinks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=SCRIPT.parent)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.resources = self.root / 'old' / 'public'
        self.resources.mkdir(parents=True)
        self.target = self.root / 'new'
        self.target.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def asset(self, name='puzzles/test.webp', data=b'unchanged artwork'):
        file = self.resources / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        return {'path': 'public/' + name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def test_real_directories_same_inode_exact_bytes_and_independent_code(self):
        assets = [self.asset(), self.asset('cosmetics/assets/test.png', b'cosmetic'), self.asset('favicon.ico', b'icon')]
        for item in assets:
            (self.resources.parent / 'service.mjs').write_bytes(b'immutable separate code')
        upgrade.link_verified_resources(self.resources, self.target, assets)
        public = self.target / 'public'
        self.assertTrue(public.is_dir())
        self.assertFalse(public.is_symlink())
        for item in assets:
            source = self.resources.parent / item['path']
            linked = self.target / item['path']
            self.assertFalse(linked.is_symlink())
            self.assertTrue(os.path.samefile(source, linked))
            self.assertEqual(upgrade.digest(linked), item['sha256'])
            upgrade.verify_file(self.target, item)
        self.assertFalse((self.target / 'service.mjs').exists())

    def test_bad_size_or_hash_rejected_before_creating_public(self):
        item = self.asset()
        for bad in [{**item, 'bytes': item['bytes'] + 1}, {**item, 'sha256': '0' * 64}]:
            with self.assertRaisesRegex(RuntimeError, 'inventory mismatch'):
                upgrade.link_verified_resources(self.resources, self.target, [bad])
            self.assertFalse((self.target / 'public').exists())

    def test_code_traversal_and_existing_public_rejected(self):
        item = self.asset()
        for name in ['server/mobile-service.mjs', 'public/puzzles/../test.webp', 'public/puzzles/../../secret']:
            with self.assertRaises(RuntimeError):
                upgrade.link_verified_resources(self.resources, self.target, [{**item, 'path': name}])
        (self.target / 'public').mkdir()
        with self.assertRaisesRegex(RuntimeError, 'must not exist'):
            upgrade.link_verified_resources(self.resources, self.target, [item])

    def test_source_symlink_file_or_parent_rejected(self):
        item = self.asset()
        source = self.resources / 'puzzles/test.webp'
        outside = self.root / 'outside.webp'
        outside.write_bytes(source.read_bytes())
        source.unlink()
        try:
            source.symlink_to(outside)
        except OSError as error:
            self.skipTest('Host cannot create symbolic links: ' + str(error))
        with self.assertRaisesRegex(RuntimeError, 'Linked resource path'):
            upgrade.link_verified_resources(self.resources, self.target, [item])
        source.unlink()
        (self.resources / 'puzzles').rmdir()
        outside_dir = self.root / 'outside'
        outside_dir.mkdir()
        (outside_dir / 'test.webp').write_bytes(outside.read_bytes())
        (self.resources / 'puzzles').symlink_to(outside_dir, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Linked resource path'):
            upgrade.link_verified_resources(self.resources, self.target, [item])

    @unittest.skipUnless(hasattr(os, 'mkfifo'), 'FIFOs only on POSIX hosts')
    def test_special_file_rejected_without_opening(self):
        item = self.asset()
        source = self.resources / 'puzzles/test.webp'
        source.unlink()
        os.mkfifo(source)
        with self.assertRaisesRegex(RuntimeError, 'Special or invalid resource path'):
            upgrade.link_verified_resources(self.resources, self.target, [item])


if __name__ == '__main__':
    unittest.main(verbosity=2)
