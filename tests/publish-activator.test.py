import hashlib
import io
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('content_activator', HERE.parent / 'scripts' / 'activate-content-release.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ActivatorTests(unittest.TestCase):
    def setUp(self):
        work = HERE.parent / 'work'
        work.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='qa-publish-activator-', dir=work)
        self.root = Path(self.temp.name).resolve()
        self.addCleanup(self.temp.cleanup)
        self.targets = [{'id': name, 'healthUrl': 'http://127.0.0.1:3100/healthz', 'preflightCommand': ['/usr/bin/node', '/srv/' + name + '/check.mjs']} for name in ('web', 'mobile')]

    def release(self, name, parent='.incoming'):
        stage = self.root / parent / name
        stage.mkdir(parents=True)
        files = []
        for filename in sorted(MODULE.REQUIRED):
            data = json.dumps({'schema': 'fixture-public/v1', 'value': name}).encode()
            (stage / filename).write_bytes(data)
            files.append({'path': filename, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        manifest = {'schema': 'jigsaw-managed-release/v1', 'releaseId': name, 'createdAt': '2026-10-13T10:00:00.000Z', 'sourceVersions': {'draftId': 'fixture', 'draftRevision': 1, 'gameRevision': 1, 'taskRevision': 1}, 'files': files}
        encoded = json.dumps(manifest).encode()
        (stage / 'manifest.json').write_bytes(encoded)
        return stage, manifest, hashlib.sha256(encoded).hexdigest()

    def request(self, name, digest):
        return {'schema': 'jigsaw-content-activation/v1', 'remoteRoot': str(self.root), 'releaseId': name, 'manifestSha256': digest, 'targets': self.targets, 'healthTimeoutSeconds': 0.1, 'preflightTimeoutSeconds': 1}

    def previous(self):
        _, _, digest = self.release('previous', 'releases')
        data = json.dumps({'schema': 'jigsaw-content-pointer/v1', 'releaseId': 'previous', 'manifestSha256': digest}, indent=2).encode()
        (self.root / 'current.json').write_bytes(data)
        return data

    def runner(self, command, **kwargs):
        self.assertFalse(kwargs['shell'])
        self.assertEqual(kwargs['env']['JIGSAW_CONTENT_RELEASE_ID'], 'next')
        return types.SimpleNamespace(returncode=0)

    def healthy(self, targets, expected, timeout):
        current = self.root / 'current.json'
        self.assertEqual(json.loads(current.read_text())['releaseId'] if current.exists() else None, expected)
        return [{'id': target['id'], 'ok': True, 'contentReleaseId': expected} for target in targets]

    def test_success_exposes_one_version_only_after_both_preflights(self):
        old = self.previous()
        stage, _, digest = self.release('next')
        calls = []
        def runner(command, **kwargs):
            self.assertEqual((self.root / 'current.json').read_bytes(), old)
            calls.append(command)
            return self.runner(command, **kwargs)
        result = MODULE.activate(self.root, stage, self.request('next', digest), self.healthy, runner)
        self.assertTrue(result['ok'])
        self.assertEqual(len(calls), 2)
        self.assertEqual(json.loads((self.root / 'current.json').read_text())['releaseId'], 'next')

    def test_failed_preflight_keeps_current_pointer_byte_for_byte(self):
        old = self.previous()
        stage, _, digest = self.release('next')
        def runner(command, **kwargs):
            return types.SimpleNamespace(returncode=1 if 'mobile' in command[1] else 0)
        result = MODULE.activate(self.root, stage, self.request('next', digest), self.healthy, runner)
        self.assertEqual(result['code'], 'PUBLISH_PREFLIGHT_FAILED')
        self.assertEqual((self.root / 'current.json').read_bytes(), old)

    def test_partial_health_failure_restores_previous_pointer_and_checks_both_targets(self):
        old = self.previous()
        stage, _, digest = self.release('next')
        calls = []
        def checker(targets, expected, timeout):
            calls.append(expected)
            result = self.healthy(targets, expected, timeout)
            if expected == 'next':
                result[1]['ok'] = False
                result[1]['contentReleaseId'] = 'previous'
            return result
        result = MODULE.activate(self.root, stage, self.request('next', digest), checker, self.runner)
        self.assertEqual(result['code'], 'PUBLISH_HEALTH_FAILED')
        self.assertTrue(result['rollback']['ok'])
        self.assertEqual(calls, ['next', 'previous'])
        self.assertEqual((self.root / 'current.json').read_bytes(), old)

    def test_first_release_rolls_back_to_absent_pointer_on_health_exception(self):
        stage, _, digest = self.release('next')
        def checker(targets, expected, timeout):
            if expected == 'next':
                raise RuntimeError('fixture failure')
            return self.healthy(targets, expected, timeout)
        result = MODULE.activate(self.root, stage, self.request('next', digest), checker, self.runner)
        self.assertTrue(result['rollback']['ok'])
        self.assertFalse((self.root / 'current.json').exists())

    def test_path_tampering_and_hash_mismatch_fail_before_preflight(self):
        old = self.previous()
        stage, manifest, digest = self.release('next')
        (stage / 'albums.json').write_text('{}')
        with self.assertRaises(MODULE.ActivationError) as failure:
            MODULE.activate(self.root, stage, self.request('next', digest), self.healthy, self.runner)
        self.assertEqual(failure.exception.code, 'RELEASE_HASH_MISMATCH')
        manifest['files'][0]['path'] = '../private.sqlite'
        encoded = json.dumps(manifest).encode()
        (stage / 'manifest.json').write_bytes(encoded)
        with self.assertRaises(MODULE.ActivationError) as failure:
            MODULE.activate(self.root, stage, self.request('next', hashlib.sha256(encoded).hexdigest()), self.healthy, self.runner)
        self.assertEqual(failure.exception.code, 'PRIVATE_RELEASE_FILE')
        self.assertEqual((self.root / 'current.json').read_bytes(), old)

    def test_private_metadata_is_rejected_even_with_matching_hashes(self):
        stage, manifest, digest = self.release('next')
        encoded = json.dumps({'schema': 'fixture-public/v1', 'password': 'not-real'}).encode()
        (stage / 'albums.json').write_bytes(encoded)
        entry = next(item for item in manifest['files'] if item['path'] == 'albums.json')
        entry.update(bytes=len(encoded), sha256=hashlib.sha256(encoded).hexdigest())
        data = json.dumps(manifest).encode()
        (stage / 'manifest.json').write_bytes(data)
        with self.assertRaises(MODULE.ActivationError) as failure:
            MODULE.activate(self.root, stage, self.request('next', hashlib.sha256(data).hexdigest()), self.healthy, self.runner)
        self.assertEqual(failure.exception.code, 'PRIVATE_RELEASE_FILE')

    def test_health_requests_forward_only_validated_optional_headers(self):
        self.targets[0]['healthHeaders'] = {'Host': 'jigsawnook.online', 'X-Forwarded-Proto': 'https'}
        MODULE.validate_targets(self.targets)
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            response = io.BytesIO(json.dumps({'ok': True, 'contentReleaseId': 'next'}).encode())
            response.status = 200
            return response
        result = MODULE.check_health(self.targets, 'next', 0.1, types.SimpleNamespace(open=open_request))
        self.assertTrue(all(item['ok'] for item in result))
        self.assertEqual(requests[0].get_header('Host'), 'jigsawnook.online')
        self.assertEqual(requests[0].get_header('X-forwarded-proto'), 'https')
        self.assertEqual(requests[1].header_items(), [])

    def test_invalid_health_headers_are_rejected_before_activation(self):
        for headers in [None, [], {'Authorization': 'fixture'}, {'Cookie': 'fixture'}, {'Host': 'example.com\r\nCookie: fixture'}, {'Host': 'bad host'}, {'Host': 'https://example.com'}, {'Host': '-bad.example'}, {'Host': 'example.com:65536'}, {'Host': 'example.com', 'host': 'second.example'}, {'X-Forwarded-Proto': 'https\r\nCookie: fixture'}, {'X-Forwarded-Proto': 'ftp'}]:
            with self.subTest(headers=headers):
                self.targets[0]['healthHeaders'] = headers
                with self.assertRaises(MODULE.ActivationError) as failure:
                    MODULE.validate_targets(self.targets)
                self.assertEqual(failure.exception.code, 'INVALID_ACTIVATION_REQUEST')


if __name__ == '__main__':
    unittest.main()
