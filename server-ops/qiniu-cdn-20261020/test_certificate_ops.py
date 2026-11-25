"""Focused non-network checks for credential signing and change boundaries."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import certificate_ops as ops


class CertificateOperationsTests(unittest.TestCase):
    def test_qbox_signature_includes_query_and_ignores_json_body(self):
        key = {'ak': 'test-ak', 'sk': 'test-sk'}
        path = '/sslcert?limit=100&marker=x'
        first = ops.qiniu_headers('POST', path, b'{"first":1}', 'fusion.qiniuapi.com', key, 'unused')
        second = ops.qiniu_headers('POST', path, b'{"second":2}', 'fusion.qiniuapi.com', key, 'unused')
        expected = base64.urlsafe_b64encode(hmac.digest(b'test-sk', (path+'\n').encode(), 'sha1')).decode()
        self.assertEqual(first['Authorization'], 'QBox test-ak:' + expected)
        self.assertEqual(first['Authorization'], second['Authorization'])
        changed = ops.qiniu_headers('POST', '/sslcert?limit=100', b'{}', 'fusion.qiniuapi.com', key, 'unused')
        self.assertNotEqual(first['Authorization'], changed['Authorization'])

    def test_qiniu_signature_binds_body(self):
        key = {'ak': 'test-ak', 'sk': 'test-sk'}
        timestamp = '20261020T120000Z'
        body = b'{"certId":"new"}'
        headers = ops.qiniu_headers('PUT', '/domain/api.ymxc.top/httpsconf', body, 'api.qiniu.com', key, timestamp)
        wire = (b'PUT /domain/api.ymxc.top/httpsconf\nHost: api.qiniu.com\n'
                b'Content-Type: application/json\nX-Qiniu-Date: 20261020T120000Z\n\n' + body)
        expected = base64.urlsafe_b64encode(hmac.digest(b'test-sk', wire, 'sha1')).decode()
        self.assertEqual(headers['Authorization'], 'Qiniu test-ak:' + expected)
        changed = ops.qiniu_headers('PUT', '/domain/api.ymxc.top/httpsconf', b'{}', 'api.qiniu.com', key, timestamp)
        self.assertNotEqual(headers['Authorization'], changed['Authorization'])

    def test_sync_changes_only_certificate_id(self):
        domain = {'name': ops.DOMAIN, 'protocol': 'https', 'https': {
            'certId': 'old', 'forceHttps': False, 'http2Enable': True, 'tlsVersions': 'TLSv1.2'}}
        new_domain = dict(domain, https=dict(domain['https'], certId='new'))
        with patch.object(ops, 'qiniu', side_effect=[domain, {}, new_domain]) as query, \
             patch.object(ops, 'upload', return_value={'certId': 'new'}), \
             patch.object(ops, 'atomic_json'):
            ops.sync()
            self.assertEqual(query.call_args_list[1].args,
                             ('PUT', '/domain/api.ymxc.top/httpsconf', {'certId': 'new'}))

    def test_sync_refuses_http_domain_before_upload(self):
        with patch.object(ops, 'qiniu', return_value={'name': ops.DOMAIN, 'protocol': 'http'}), \
             patch.object(ops, 'upload') as upload:
            with self.assertRaises(RuntimeError):
                ops.sync()
            upload.assert_not_called()


if __name__ == '__main__':
    unittest.main()
