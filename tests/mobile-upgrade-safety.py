"""Focused archive/path/online-backup checks; never contacts production."""
import hashlib
import importlib.util
import io
import json
import pathlib
import sqlite3
import tarfile
import tempfile
import unittest
import zipfile
import argparse
from contextlib import ExitStack, closing
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/upgrade-mobile-backend.py'
spec = importlib.util.spec_from_file_location('mobile_upgrade', SCRIPT)
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeSafety(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'work')
        self.folder = pathlib.Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def archive(self, extra=None, tamper=False):
        content = b'export const test = true;'
        name = 'server/mobile-social.mjs'
        manifest = {'packageKind': 'code-delta', 'files': [{'path': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
        target = self.folder / 'test.tar.gz'
        with tarfile.open(target, 'w:gz') as bundle:
            for filename, data in [('release.json', json.dumps(manifest).encode()), (name, content[:-1] + b'!' if tamper else content)]:
                item = tarfile.TarInfo(filename)
                item.size = len(data)
                bundle.addfile(item, io.BytesIO(data))
            if extra:
                bundle.addfile(extra)
        return target

    def test_real_fixed_delta_inventory_and_syntax(self):
        compile(SCRIPT.read_text(), str(SCRIPT), 'exec')
        archive = ROOT / 'releases/jigsaw-mobile-upgrade-20261013-social34.tar.gz'
        self.assertEqual(upgrade.digest(archive), '2f72e7858d6a541cedee198ab7156fb5f8a6dcdd2b8dece4705ba85486191d37')
        manifest, payload = upgrade.package_inventory(archive)
        self.assertEqual(manifest['release'], '20261013-social34')
        self.assertEqual(manifest['assetCount'], 451)
        self.assertEqual(len(payload), 11)
        self.assertFalse(any(path.startswith('public/') for path in payload))

    def test_absolute_traversal_private_and_unexpected_paths_rejected(self):
        for path in ['outputs/mobile/artwork.mjs', 'scripts/check-artwork-revisions.mjs', 'content/artwork-revisions.json', 'content/puzzle-catalog.json', 'content/image-provenance/lantern-dance-v1.json']:
            with self.subTest(path=path):
                self.assertEqual(str(upgrade.safe_path(path)), path)
        for path in ['/etc/passwd', '../server/mobile-social.mjs', 'server/../mobile-social.mjs', 'server\\mobile-social.mjs', 'data/mobile.sqlite', '.env', 'server/extra.py', 'public/puzzles/../../secret', 'public/puzzles/private.key']:
            with self.subTest(path=path), self.assertRaises(RuntimeError):
                upgrade.safe_path(path)
        for service in ['jigsaw-web@3103.service', 'jigsaw-web@3104.service', 'jigsaw-web@65535.service']:
            self.assertEqual(upgrade.validated_pc_service(service), service)
        for service in ['jigsaw-h5.service', 'jigsaw-web@0.service', 'jigsaw-web@65536.service', 'jigsaw-web@03103.service', 'jigsaw-web@3103.service;reboot', '../jigsaw-web@3103.service', 'jigsaw-web@-1.service']:
            with self.subTest(service=service), self.assertRaises(argparse.ArgumentTypeError):
                upgrade.validated_pc_service(service)
        with patch.object(upgrade, 'run', return_value='active') as commands:
            snapshot = upgrade.fingerprint([], [], 'jigsaw-web@3103.service')
        self.assertEqual(snapshot['services'], {'jigsaw-web@3103.service': 'active', 'jigsaw-h5.service': 'active'})
        self.assertEqual([call.args for call in commands.call_args_list], [('systemctl', 'is-active', 'jigsaw-web@3103.service'), ('systemctl', 'is-active', 'jigsaw-h5.service')])

    def test_tar_links_duplicates_and_unlisted_members_rejected(self):
        for kind, name in [(tarfile.SYMTYPE, 'public/puzzles/link.webp'), (tarfile.LNKTYPE, 'public/puzzles/hard.webp'), (tarfile.REGTYPE, 'server/mobile-social.mjs'), (tarfile.REGTYPE, 'public/puzzles/unlisted.webp')]:
            extra = tarfile.TarInfo(name)
            extra.type = kind
            extra.linkname = '/etc/passwd'
            with self.subTest(kind=kind, name=name), self.assertRaises(RuntimeError):
                upgrade.package_inventory(self.archive(extra=extra))

    def test_hash_tampering_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
            upgrade.package_inventory(self.archive(tamper=True))

    def test_equivalent_zip_inventory_is_verified(self):
        original = self.archive()
        target = self.folder / 'valid.zip'
        with tarfile.open(original) as source, zipfile.ZipFile(target, 'w') as output:
            for member in source.getmembers():
                output.writestr(member.name, source.extractfile(member).read())
        manifest, payload = upgrade.package_inventory(target)
        self.assertEqual(manifest['packageKind'], 'code-delta')
        self.assertEqual(payload, {'server/mobile-social.mjs'})

    def test_multifile_payload_hashes_follow_physical_order_and_reject_corruption(self):
        # Deliberately disagree with name order and manifest order. ZIP central
        # directory order is also reversed to ensure offsets drive verification.
        names = ['public/puzzles/order-' + str(index) + '.webp' for index in [11, 3, 17, 0, 12, 5, 19, 1, 8, 2, 16, 4, 9, 7, 14, 6, 18, 10, 15, 13]]
        contents = {name: ('payload ' + name).encode() for name in names}
        manifest = {'packageKind': 'full', 'files': [{'path': name, 'bytes': len(contents[name]), 'sha256': hashlib.sha256(contents[name]).hexdigest()} for name in reversed(names)]}
        for zipped in [False, True]:
            for corrupt in [False, True]:
                with self.subTest(zipped=zipped, corrupt=corrupt):
                    target = self.folder / ('ordered.zip' if zipped else 'ordered.tar.gz')
                    entries = [(name, contents[name][:-1] + b'!' if corrupt and name == names[-1] else contents[name]) for name in names]
                    entries.append(('release.json', json.dumps(manifest).encode()))
                    if zipped:
                        with zipfile.ZipFile(target, 'w') as output:
                            for name, data in entries:
                                output.writestr(name, data)
                    else:
                        with tarfile.open(target, 'w:gz') as output:
                            for name, data in entries:
                                item = tarfile.TarInfo(name)
                                item.size = len(data)
                                output.addfile(item, io.BytesIO(data))
                    visited = []
                    original_tar_read = tarfile.TarFile.extractfile
                    original_zip_read = zipfile.ZipFile.open
                    original_zip_list = zipfile.ZipFile.infolist

                    def tar_read(bundle, member):
                        visited.append(member.name)
                        return original_tar_read(bundle, member)

                    def zip_read(bundle, member, *args, **kwargs):
                        visited.append(member.filename)
                        return original_zip_read(bundle, member, *args, **kwargs)

                    with ExitStack() as stack:
                        if zipped:
                            stack.enter_context(patch.object(zipfile.ZipFile, 'open', zip_read))
                            stack.enter_context(patch.object(zipfile.ZipFile, 'infolist', lambda bundle: list(reversed(original_zip_list(bundle)))))
                        else:
                            stack.enter_context(patch.object(tarfile.TarFile, 'extractfile', tar_read))
                        if corrupt:
                            with self.assertRaisesRegex(RuntimeError, 'Archive hash mismatch: ' + names[-1]):
                                upgrade.package_inventory(target)
                        else:
                            _, payload = upgrade.package_inventory(target)
                            self.assertEqual(payload, set(names))
                    self.assertEqual(visited, ['release.json', *names])

    def test_zip_symlink_rejected(self):
        target = self.folder / 'link.zip'
        info = zipfile.ZipInfo('public/puzzles/link.webp')
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        with zipfile.ZipFile(target, 'w') as output:
            output.writestr(info, '/etc/passwd')
        with self.assertRaisesRegex(RuntimeError, 'link or device'):
            upgrade.package_inventory(target)

    def test_online_backup_preserves_committed_data_and_does_not_restore_it(self):
        shared = self.folder / 'shared'
        shared.mkdir()
        for name in ['mobile-v3.sqlite', 'sessions.sqlite']:
            with closing(sqlite3.connect(shared / name)) as source, source:
                source.execute('PRAGMA journal_mode=WAL')
                source.execute('CREATE TABLE progress(value INTEGER)')
                source.execute('INSERT INTO progress VALUES(1)')
        folder = shared / 'backups' / 'upgrade-test'
        records = upgrade.online_backups(shared, folder)
        self.assertEqual(len(records), 2)
        with closing(sqlite3.connect(shared / 'mobile-v3.sqlite')) as source, source:
            source.execute('UPDATE progress SET value=2')
        with closing(sqlite3.connect(folder / 'mobile-v3.sqlite')) as backup:
            self.assertEqual(backup.execute('SELECT value FROM progress').fetchone(), (1,))
        with closing(sqlite3.connect(shared / 'mobile-v3.sqlite')) as source:
            self.assertEqual(source.execute('SELECT value FROM progress').fetchone(), (2,))


if __name__ == '__main__':
    unittest.main()
