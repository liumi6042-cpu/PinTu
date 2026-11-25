#!/usr/bin/env python3
"""Certificate-only Qiniu reconciliation for api.ymxc.top.

Python stdlib only. Secrets stay in a root-only JSON file, never command arguments.
Install and enable only after the API permissions and live readback are verified.
"""
import argparse
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

DOMAIN = 'api.ymxc.top'
CONFIG = Path('/etc/jigsaw-cdn-cert/credentials.json')
STATE = Path('/var/lib/jigsaw-cdn-cert')
LINEAGE = Path('/etc/letsencrypt/live') / DOMAIN


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def credentials(section):
    info = CONFIG.stat()
    require(info.st_uid == 0 and info.st_mode & 0o077 == 0,
            'Credentials must be owned by root with mode 0600')
    config = json.loads(CONFIG.read_text())
    pair = config.get(section, {})
    require(pair.get('ak') and pair.get('sk'), f'Missing {section} API credentials')
    return pair


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out)
    os.replace(temp, path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # Never forward credentials or certificate keys to another host.


def request_json(url, method='GET', body=None, headers=None):
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(urllib.request.Request(url, data=body, method=method,
                                               headers=headers or {}), timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Do not emit bodies or URLs: they can contain credentials and private keys.
        raise RuntimeError(f'Provider HTTP {error.code}') from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError('Provider network request failed') from None
    require(isinstance(result, dict), 'Invalid provider response')
    require(not result.get('error') and result.get('code', 200) in (0, 200),
            'Provider rejected operation')
    return result


def qiniu_headers(method, path, body, host, key, timestamp):
    headers = {'Host': host}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    if host == 'fusion.qiniuapi.com':
        signed = (path + '\n').encode()
        scheme = 'QBox'
    else:
        require(host == 'api.qiniu.com', 'Refused unexpected Qiniu endpoint')
        headers['X-Qiniu-Date'] = timestamp
        signed = f'{method} {path}\nHost: {host}'
        if body is not None:
            signed += '\nContent-Type: application/json'
        signed += '\nX-Qiniu-Date: ' + timestamp + '\n\n'
        signed = signed.encode() + (body or b'')
        scheme = 'Qiniu'
    digest = base64.urlsafe_b64encode(hmac.new(key['sk'].encode(), signed, hashlib.sha1).digest()).decode()
    headers['Authorization'] = scheme + ' ' + key['ak'] + ':' + digest
    return headers


def qiniu(method, path, data=None, host='api.qiniu.com'):
    key = credentials('qiniu')
    body = json.dumps(data, separators=(',', ':')).encode() if data is not None else None
    timestamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    headers = qiniu_headers(method, path, body, host, key, timestamp)
    return request_json('https://' + host + path, method, body, headers)


def openssl(*args, data=None):
    result = subprocess.run(['openssl', *args], input=data, capture_output=True)
    require(result.returncode == 0, 'Certificate validation failed')
    return result.stdout


def certificate():
    cert_path, key_path = LINEAGE / 'fullchain.pem', LINEAGE / 'privkey.pem'
    fullchain, private = cert_path.read_text(), key_path.read_text()
    decoded = ssl._ssl._test_decode_cert(str(cert_path))
    names = [name for kind, name in decoded['subjectAltName'] if kind == 'DNS']
    require(names == [DOMAIN], 'Certificate SAN must contain only api.ymxc.top')
    cert_public = openssl('x509', '-in', str(cert_path), '-pubkey', '-noout')
    key_public = openssl('pkey', '-in', str(key_path), '-pubout')
    require(cert_public == key_public, 'Certificate/private key mismatch')
    expiry = ssl.cert_time_to_seconds(decoded['notAfter'])
    require(expiry > time.time(), 'Certificate expired')
    fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(fullchain.split(
        '-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----')).hexdigest()
    return fullchain, private, fingerprint, expiry


def upload():
    fullchain, private, fingerprint, expiry = certificate()
    path = STATE / 'qiniu.json'
    state = json.loads(path.read_text()) if path.exists() else {}
    if state.get('fingerprint') == fingerprint and state.get('certId'):
        # Verify the existing uploaded certificate; never trust local state alone.
        detail = qiniu('GET', '/sslcert/' + urllib.parse.quote(state['certId'], safe=''),
                       host='fusion.qiniuapi.com')['cert']
        require(hashlib.sha256(ssl.PEM_cert_to_DER_cert(detail['ca'].split(
            '-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----')).hexdigest() == fingerprint,
            'Uploaded certificate fingerprint mismatch')
        return state
    require(expiry - time.time() >= 30 * 86400, 'New Qiniu upload needs at least 30 days remaining')
    name = DOMAIN + '-LE-' + fingerprint[:16]
    # Recover an upload whose response was lost, without creating another certificate.
    marker, cert_id = '', None
    while True:
        listing = qiniu('GET', '/sslcert?' + urllib.parse.urlencode({'limit': 100, 'marker': marker}),
                        host='fusion.qiniuapi.com')
        for item in listing.get('certs', []):
            if item.get('name') == name and item.get('common_name') == DOMAIN:
                detail = qiniu('GET', '/sslcert/' + item['certid'], host='fusion.qiniuapi.com')['cert']
                remote_der = ssl.PEM_cert_to_DER_cert(detail['ca'].split(
                    '-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----')
                if hashlib.sha256(remote_der).hexdigest() == fingerprint:
                    cert_id = item['certid']
                    break
        new_marker = listing.get('marker', '')
        if cert_id or not new_marker:
            break
        require(new_marker != marker, 'Certificate pagination did not advance')
        marker = new_marker
    if not cert_id:
        cert_id = qiniu('POST', '/sslcert', {'name': name, 'ca': fullchain, 'pri': private},
                        host='fusion.qiniuapi.com')['certID']
    detail = qiniu('GET', '/sslcert/' + cert_id, host='fusion.qiniuapi.com')['cert']
    remote_der = ssl.PEM_cert_to_DER_cert(detail['ca'].split(
        '-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----')
    require(hashlib.sha256(remote_der).hexdigest() == fingerprint,
            'Uploaded certificate fingerprint mismatch')
    state = {'certId': cert_id, 'fingerprint': fingerprint, 'expiresAt': expiry}
    atomic_json(path, state)
    return state


def sync():
    # This tool never creates a CDN domain, changes DNS, cache, origin or TLS policy.
    path = '/domain/' + DOMAIN
    domain = qiniu('GET', path)
    require(domain.get('name') == DOMAIN and domain.get('protocol') == 'https',
            'Create and verify the HTTPS CDN domain before enabling automatic synchronization')
    previous = domain.get('https', {})
    require(isinstance(previous, dict), 'Unexpected CDN HTTPS configuration')
    state = upload()
    if previous.get('certId') == state['certId']:
        print('Certificate binding already current')
        return
    require(previous.get('certId'), 'Missing existing HTTPS certificate; manual review required')
    atomic_json(STATE / ('binding-before-' + str(int(time.time())) + '.json'),
                {'domain': DOMAIN, 'https': previous})
    qiniu('PUT', path + '/httpsconf', {'certId': state['certId']})
    for _ in range(24):
        current = qiniu('GET', path)
        if current.get('https', {}).get('certId') == state['certId']:
            print('Qiniu API certificate binding verified; edge propagation may take 5-10 minutes')
            return
        time.sleep(5)
    raise RuntimeError('Certificate update accepted but readback pending; retry synchronization later')


def preflight():
    credentials('qiniu')
    domain = qiniu('GET', '/domain/' + DOMAIN)
    require(domain.get('name') == DOMAIN and domain.get('protocol') == 'https'
            and domain.get('https', {}).get('certId'),
            'HTTPS CDN domain and initial certificate binding must exist first')
    certificate()
    print('Qiniu HTTPS domain and local certificate preflight passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['check', 'preflight', 'upload', 'sync'])
    args = parser.parse_args()
    try:
        if args.operation == 'check':
            _, _, fingerprint, expiry = certificate()
            print(json.dumps({'domain': DOMAIN, 'fingerprint': fingerprint, 'expiresAt': expiry}))
        else:
            import fcntl
            STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
            with open(STATE / 'operation.lock', 'a') as lock:
                os.chmod(STATE / 'operation.lock', 0o600)
                fcntl.flock(lock, fcntl.LOCK_EX)
                {'preflight': preflight,
                 'upload': upload, 'sync': sync}[args.operation]()
    except Exception as error:
        # Unexpected errors might embed signed URLs; never print their original text.
        print(str(error) if isinstance(error, RuntimeError) else
              'Certificate operation failed (' + type(error).__name__ + ')', file=sys.stderr)
        sys.exit(1)
