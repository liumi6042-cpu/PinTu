#!/usr/bin/env python3
"""Validate a public content release and atomically activate it for both services.

No database access, service restart or shell execution is performed here. The
request is uploaded by a trusted admin transport, not accepted from HTTP input.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

REQUIRED = {'albums.json', 'daily.json', 'game-settings.json', 'task-rewards.json'}
ALLOWED = REQUIRED | {'assets.json'}
STAGE_FILES = ALLOWED | {'manifest.json', 'activation-request.json', 'activate-content-release.py'}
RELEASE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{0,99}$')
WINDOWS_DEVICE = re.compile(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])$', re.I)
HASH = re.compile(r'^[a-f0-9]{64}$')
PRIVATE_KEYS = {'_private', 'password', 'passwordhash', 'secret', 'token', 'accesstoken', 'refreshtoken', 'privatekey', 'credentials', 'cookie', 'authorization', 'csrftoken', 'session', 'sessions', 'playerid', 'owner'}
MAX_FILE_BYTES = 32 * 1024 * 1024


class ActivationError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise ActivationError(code, message)


def read_json(path, limit=MAX_FILE_BYTES):
    require(path.is_file() and not path.is_symlink(), 'INVALID_RELEASE', '发布文件缺失或使用了不允许的链接。')
    data = path.read_bytes()
    require(len(data) <= limit, 'INVALID_RELEASE', '发布文件超出允许大小。')
    try:
        document = json.loads(data)
    except (UnicodeDecodeError, ValueError):
        raise ActivationError('INVALID_RELEASE', '发布文件不是有效 JSON。')
    return document, data


def check_public(value):
    if isinstance(value, dict):
        for key, item in value.items():
            require(key.lower() not in PRIVATE_KEYS, 'PRIVATE_RELEASE_FILE', '发布内容包含私有信息字段。')
            check_public(item)
    elif isinstance(value, list):
        for item in value:
            check_public(item)


def validate_release(directory, release_id, manifest_hash):
    require(isinstance(release_id, str) and RELEASE_ID.fullmatch(release_id) and not WINDOWS_DEVICE.fullmatch(release_id), 'INVALID_RELEASE', '版本标识无效。')
    require(isinstance(manifest_hash, str) and HASH.fullmatch(manifest_hash), 'INVALID_RELEASE', '版本校验值无效。')
    manifest, encoded = read_json(directory / 'manifest.json')
    require(hashlib.sha256(encoded).hexdigest() == manifest_hash, 'RELEASE_HASH_MISMATCH', '发布清单校验失败。')
    require(isinstance(manifest, dict) and manifest.get('schema') == 'jigsaw-managed-release/v1' and manifest.get('releaseId') == release_id, 'INVALID_RELEASE', '发布清单与本次提交不符。')
    require(set(manifest) == {'schema', 'releaseId', 'createdAt', 'sourceVersions', 'files'}, 'INVALID_RELEASE', '发布清单包含缺失或未定义字段。')
    check_public(manifest)
    files = manifest.get('files')
    require(isinstance(files, list) and 4 <= len(files) <= 5, 'INVALID_RELEASE', '发布内容不完整。')
    seen = set()
    for entry in files:
        require(isinstance(entry, dict) and set(entry) == {'path', 'bytes', 'sha256'}, 'INVALID_RELEASE', '发布文件记录无效。')
        name = entry['path']
        require(isinstance(name, str) and name in ALLOWED and name not in seen, 'PRIVATE_RELEASE_FILE', '发布清单包含不允许的路径或重复文件。')
        seen.add(name)
        document, data = read_json(directory / name)
        require(type(entry['bytes']) is int and 0 <= entry['bytes'] <= MAX_FILE_BYTES and len(data) == entry['bytes'], 'RELEASE_HASH_MISMATCH', '发布文件大小校验失败。')
        require(isinstance(entry['sha256'], str) and HASH.fullmatch(entry['sha256']) and hashlib.sha256(data).hexdigest() == entry['sha256'], 'RELEASE_HASH_MISMATCH', '发布文件内容校验失败。')
        require(isinstance(document, dict), 'INVALID_RELEASE', '公开配置必须是 JSON 对象。')
        check_public(document)
    require(REQUIRED <= seen, 'INVALID_RELEASE', '发布缺少必需的公开配置。')
    return manifest


def atomic_bytes(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_health_headers(value):
    if value is None:
        return {}
    require(isinstance(value, dict), 'INVALID_ACTIVATION_REQUEST', '健康检查请求头配置无效。')
    headers = {}
    for name, header in value.items():
        key = {'host': 'Host', 'x-forwarded-proto': 'X-Forwarded-Proto'}.get(name.lower()) if isinstance(name, str) else None
        require(key is not None and key not in headers and isinstance(header, str), 'INVALID_ACTIVATION_REQUEST', '健康检查只允许 Host 与 X-Forwarded-Proto 请求头。')
        if key == 'Host':
            parts = header.split(':')
            hostname = parts[0]
            valid_hostname = len(hostname) <= 253 and all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in hostname.split('.'))
            valid_port = len(parts) == 1 or (len(parts) == 2 and re.fullmatch(r'[0-9]{1,5}', parts[1]) and 1 <= int(parts[1]) <= 65535)
            require(valid_hostname and valid_port, 'INVALID_ACTIVATION_REQUEST', '健康检查 Host 必须是有效域名及可选端口。')
        else:
            require(header in ('http', 'https'), 'INVALID_ACTIVATION_REQUEST', '健康检查转发协议只能是 http 或 https。')
        headers[key] = header
    return headers


def validate_targets(targets):
    require(isinstance(targets, list) and len(targets) == 2, 'INVALID_ACTIVATION_REQUEST', '必须同时校验两个目标。')
    seen = set()
    for target in targets:
        require(isinstance(target, dict) and target.get('id') in ('web', 'mobile') and target['id'] not in seen, 'INVALID_ACTIVATION_REQUEST', '发布目标无效。')
        seen.add(target['id'])
        try:
            url = urllib.parse.urlparse(target['healthUrl'])
            port = url.port
        except (KeyError, TypeError, ValueError):
            raise ActivationError('INVALID_ACTIVATION_REQUEST', '目标健康检查地址无效。')
        require(url.scheme == 'http' and url.hostname in ('127.0.0.1', '::1', 'localhost') and not url.username and not url.password and not url.query and not url.fragment and (port is None or 0 < port < 65536), 'INVALID_ACTIVATION_REQUEST', '健康检查只允许服务器本机地址。')
        if 'healthHeaders' in target:
            require(isinstance(target['healthHeaders'], dict), 'INVALID_ACTIVATION_REQUEST', '健康检查请求头配置无效。')
        validate_health_headers(target.get('healthHeaders'))
        command = target.get('preflightCommand')
        require(isinstance(command, list) and 1 <= len(command) <= 16 and all(isinstance(part, str) and 0 < len(part) <= 1024 and not any(char in part for char in '\x00\r\n') for part in command) and command[0].startswith('/'), 'INVALID_ACTIVATION_REQUEST', '目标预检命令无效。')


def check_health(targets, expected, timeout_seconds, opener=None):
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout_seconds
    receipts = []
    while True:
        receipts = []
        for target in targets:
            receipt = {'id': target['id'], 'ok': False, 'contentReleaseId': None}
            try:
                request = urllib.request.Request(target['healthUrl'], headers=validate_health_headers(target.get('healthHeaders')))
                with opener.open(request, timeout=min(3, max(0.1, deadline - time.monotonic()))) as response:
                    payload = response.read(65537)
                    if response.status == 200 and len(payload) <= 65536:
                        health = json.loads(payload)
                        release_id = health.get('contentReleaseId')
                        if release_id is None or (isinstance(release_id, str) and RELEASE_ID.fullmatch(release_id)):
                            receipt['contentReleaseId'] = release_id
                            receipt['ok'] = health.get('ok') is True and release_id == expected
            except (OSError, ValueError, AttributeError):
                pass
            receipts.append(receipt)
        if all(receipt['ok'] for receipt in receipts) or time.monotonic() >= deadline:
            return receipts
        time.sleep(min(0.25, max(0, deadline - time.monotonic())))


def activate(root, stage, request, health_checker=check_health, runner=subprocess.run):
    require(root.is_absolute() and root.resolve() == root and not root.is_symlink(), 'INVALID_ACTIVATION_REQUEST', '正式服发布目录无效。')
    require(stage.parent == root / '.incoming' and stage.resolve() == stage and not stage.is_symlink(), 'INVALID_ACTIVATION_REQUEST', '临时发布目录超出允许范围。')
    require(request.get('schema') == 'jigsaw-content-activation/v1' and request.get('remoteRoot') == str(root), 'INVALID_ACTIVATION_REQUEST', '发布请求格式无效。')
    targets = request.get('targets')
    validate_targets(targets)
    release_id, manifest_hash = request.get('releaseId'), request.get('manifestSha256')
    manifest = validate_release(stage, release_id, manifest_hash)
    require(all(item.name in STAGE_FILES and item.is_file() and not item.is_symlink() for item in stage.iterdir()), 'PRIVATE_RELEASE_FILE', '临时发布目录中存在未允许的文件。')
    health_timeout, preflight_timeout = request.get('healthTimeoutSeconds', 30), request.get('preflightTimeoutSeconds', 45)
    require(type(health_timeout) in (int, float) and 0 < health_timeout <= 45 and type(preflight_timeout) in (int, float) and 0 < preflight_timeout <= 60, 'INVALID_ACTIVATION_REQUEST', '发布检查超时时间无效。')
    releases = root / 'releases'
    os.chmod(root, 0o755)
    releases.mkdir(mode=0o755, exist_ok=True)
    require(releases.resolve() == releases and not releases.is_symlink(), 'INVALID_ACTIVATION_REQUEST', '版本目录不允许使用链接。')
    destination = releases / release_id
    if destination.exists():
        require(destination.is_dir() and not destination.is_symlink(), 'INVALID_RELEASE', '同名版本目录不可用。')
        validate_release(destination, release_id, manifest_hash)
    else:
        temporary = Path(tempfile.mkdtemp(prefix='.' + release_id + '-', dir=releases))
        try:
            for filename in [entry['path'] for entry in manifest['files']] + ['manifest.json']:
                shutil.copyfile(stage / filename, temporary / filename)
                os.chmod(temporary / filename, 0o644)
            validate_release(temporary, release_id, manifest_hash)
            os.chmod(temporary, 0o755)
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
    env = {**os.environ, 'JIGSAW_CONTENT_RELEASE_DIR': str(destination), 'JIGSAW_CONTENT_RELEASE_ID': release_id, 'JIGSAW_CONTENT_MANIFEST_SHA256': manifest_hash}
    preflights = []
    for target in targets:
        try:
            result = runner(target['preflightCommand'], env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=preflight_timeout, check=False, shell=False)
            ok = result.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            ok = False
        preflights.append({'id': target['id'], 'ok': ok})
    if not all(item['ok'] for item in preflights):
        return {'schema': 'jigsaw-content-publish-receipt/v1', 'releaseId': release_id, 'ok': False, 'code': 'PUBLISH_PREFLIGHT_FAILED', 'message': '两端内容预检未全部通过，正式服当前版本未切换。', 'phase': 'preflight', 'targets': preflights, 'rollback': {'attempted': False}}
    pointer = root / 'current.json'
    previous_bytes, previous_id = None, None
    if pointer.exists():
        previous, previous_bytes = read_json(pointer, 16384)
        require(isinstance(previous, dict) and previous.get('schema') == 'jigsaw-content-pointer/v1', 'INVALID_CURRENT_POINTER', '正式服当前版本记录无效，已停止切换。')
        previous_id = previous.get('releaseId')
        validate_release(releases / str(previous_id), previous_id, previous.get('manifestSha256'))
    pointer_bytes = json.dumps({'schema': 'jigsaw-content-pointer/v1', 'releaseId': release_id, 'manifestSha256': manifest_hash}, separators=(',', ':')).encode('utf8')
    atomic_bytes(pointer, pointer_bytes)
    try:
        targets_receipt = health_checker(targets, release_id, health_timeout)
    except Exception:
        targets_receipt = [{'id': target['id'], 'ok': False, 'contentReleaseId': None} for target in targets]
    if all(item['ok'] for item in targets_receipt):
        return {'schema': 'jigsaw-content-publish-receipt/v1', 'releaseId': release_id, 'previousReleaseId': previous_id, 'ok': True, 'phase': 'active', 'targets': targets_receipt, 'rollback': {'attempted': False}}
    try:
        if previous_bytes is None:
            pointer.unlink()
        else:
            atomic_bytes(pointer, previous_bytes)
        rollback_targets = health_checker(targets, previous_id, health_timeout)
        rolled_back = all(item['ok'] for item in rollback_targets)
    except Exception:
        rollback_targets, rolled_back = [], False
    return {'schema': 'jigsaw-content-publish-receipt/v1', 'releaseId': release_id, 'ok': False, 'code': 'PUBLISH_HEALTH_FAILED' if rolled_back else 'PUBLISH_ROLLBACK_UNVERIFIED', 'message': '同步检查未通过，已恢复先前版本。' if rolled_back else '同步检查未通过；回退状态仍需检查。', 'phase': 'rolled-back' if rolled_back else 'rollback-unverified', 'targets': targets_receipt, 'rollback': {'attempted': True, 'ok': rolled_back, 'releaseId': previous_id, 'targets': rollback_targets}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--request', required=True)
    arguments = parser.parse_args()
    root, request_path = Path(arguments.root), Path(arguments.request)
    release_id = None
    try:
        require(root.is_absolute() and root.resolve() == root and not root.is_symlink(), 'INVALID_ACTIVATION_REQUEST', '正式服发布目录无效。')
        require(request_path.name == 'activation-request.json' and request_path.parent.parent == root / '.incoming', 'INVALID_ACTIVATION_REQUEST', '发布请求文件超出允许范围。')
        request, _ = read_json(request_path, 32768)
        require(isinstance(request, dict), 'INVALID_ACTIVATION_REQUEST', '发布请求必须是 JSON 对象。')
        release_id = request.get('releaseId')
        import fcntl
        lock_path = root / '.activation.lock'
        require(not lock_path.is_symlink(), 'INVALID_ACTIVATION_REQUEST', '发布锁文件不可用。')
        with open(lock_path, 'a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ActivationError('PUBLISH_BUSY', '另一个提交正在同步，请稍后重试。')
            receipt = activate(root, request_path.parent, request)
    except ActivationError as error:
        receipt = {'schema': 'jigsaw-content-publish-receipt/v1', 'releaseId': release_id, 'ok': False, 'code': error.code, 'message': str(error), 'targets': []}
    except Exception:
        receipt = {'schema': 'jigsaw-content-publish-receipt/v1', 'releaseId': release_id, 'ok': False, 'code': 'PUBLISH_ACTIVATION_FAILED', 'message': '服务器同步出现异常，请检查当前版本。', 'targets': []}
    print(json.dumps(receipt, ensure_ascii=False, separators=(',', ':')))
    return 0 if receipt['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
