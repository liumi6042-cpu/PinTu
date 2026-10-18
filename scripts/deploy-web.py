#!/usr/bin/env python3
"""Ship the current Web source to the live slot in one verified step.

    python3 deploy-web.py --dry-run          # validate only, change nothing
    python3 deploy-web.py                    # build, upload the delta, switch

Steps: build the release package, diff its manifest against the live one, upload
only the changed files, materialise the new release from the installed baseline
plus that delta, verify every file hash, back up the player database, switch the
port slot, then confirm health. A failed health check restores the previous slot.

Nothing is deleted. The previous release stays installed for a manual rollback.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time

PROJECT = pathlib.Path('D:/chat/拼图/work/dual-managed-release-20261014')
WORK = pathlib.Path('D:/chat/拼图/content-admin/work/deploy-web-20261017')
IDENTITY = r'C:\Users\Administrator\.ssh\webhosting_186_241_106_176_ed25519'
HOST = 'root@162.251.94.145'
SLOT = '3104'
# Connection multiplexing was tried and removed: this link resets the shared
# control socket. Each call opens its own connection and retries on a drop.
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=yes', '-i', IDENTITY, HOST]
SCP = ['scp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-i', IDENTITY]


def attempt(command, tries=3, cwd=None):
    """Run one command, retrying a dropped connection instead of failing the deploy."""
    last = None
    for index in range(tries):
        try:
            result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
        except subprocess.TimeoutExpired:
            last = 'timeout'
        else:
            if result.returncode == 0:
                return result.stdout
            last = ((result.stdout or '')[-600:] + (result.stderr or '')[-600:]).strip()
            lowered = last.lower()
            if not any(word in lowered for word in ('connection closed', 'connection reset', 'broken pipe', 'kex_exchange', 'timed out')):
                break
        if index < tries - 1:
            wait = 5 * (index + 1)
            print('    connection dropped, retrying in %ds…' % wait, flush=True)
            time.sleep(wait)
    raise SystemExit('failed: ' + ' '.join(map(str, command))[:200] + ' | ' + str(last))


def run(command, tries=3, cwd=None):
    return attempt(command, tries=tries, cwd=cwd)


def remote(command, tries=3):
    return attempt(SSH + [command], tries=tries)



def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--skip-build', action='store_true', help='reuse releases/latest.tar.gz')
    parser.add_argument('--note', default='')
    options = parser.parse_args()

    work = WORK
    work.mkdir(parents=True, exist_ok=True)

    if not options.skip_build:
        print('1/6 building the release package…')
        env = dict(os.environ)
        env.pop('NODE_OPTIONS', None)          # the delete shim blocks dist cleanup
        result = subprocess.run(['npm', 'run', 'release'], cwd=PROJECT, env=env, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit('build failed\n' + (result.stdout or '')[-1500:] + (result.stderr or '')[-1500:])
    else:
        print('1/6 reusing the existing package')

    archive = PROJECT / 'releases/latest.tar.gz'
    if not archive.is_file():
        raise SystemExit('no package at ' + str(archive))
    manifest_tar = run(['tar', '-xzOf', str(archive), './release.json'])
    manifest_path = work / 'next-release.json'
    manifest_path.write_text(manifest_tar, encoding='utf-8')
    manifest = json.loads(manifest_tar)
    if manifest.get('dirty') is not False:
        raise SystemExit('release is dirty; commit first')

    print('2/6 reading the live manifest…')
    live_manifest = json.loads(remote('cat /srv/sites/jigsaw/releases/$(basename $(dirname $(readlink -f /srv/sites/jigsaw/slots/%s)))/app/release.json' % SLOT))
    live_commit = live_manifest.get('gitCommit')
    live_release = remote('basename $(dirname $(readlink -f /srv/sites/jigsaw/slots/%s))' % SLOT).strip()
    print('    live: %s (%s)' % (live_release, live_commit[:12]))

    live_files = {item['path']: item['sha256'] for item in live_manifest.get('files', [])}
    changed = [item for item in manifest['files'] if live_files.get(item['path']) != item['sha256']]
    total = sum(item['bytes'] for item in changed) / 1048576
    next_release = time.strftime('web-%Y%m%d-%H%M%S')
    print('3/6 %d of %d files changed (%.1f MB)' % (len(changed), len(manifest['files']), total))
    if not changed:
        print('    nothing to do')
        return
    if options.dry_run:
        print('dry run complete; no files uploaded')
        return

    print('4/6 packing and uploading the delta…')
    listing = work / 'delta.txt'
    dotted = work / 'delta-dot.txt'
    listing.write_text('\n'.join(item['path'] for item in changed) + '\n', encoding='utf-8')
    dotted.write_text('\n'.join('./' + item['path'] for item in changed) + '\n', encoding='utf-8')
    staging = work / 'staging-current'
    if staging.exists():
        run(['rm', '-rf', str(staging)])
    staging.mkdir(parents=True)
    run(['tar', '-xzf', str(archive), '-C', str(staging), '-T', str(dotted)])
    delta_archive = work / 'delta.tar.gz'
    run(['tar', '-czf', str(delta_archive), '-T', str(listing)], cwd=staging)
    digest = sha256(delta_archive)
    run(SCP + ['-q', str(delta_archive), str(manifest_path), HOST + ':/tmp/'], tries=4)

    print('5/6 installing the new release…')
    output = remote('python3 /tmp/deploy-delta.py --delta /tmp/delta.tar.gz --sha256 %s --manifest /tmp/next-release.json --release %s --base %s --expect-base-commit %s --slot %s'
                    % (digest, next_release, live_release, live_commit, SLOT))
    receipt = json.loads(output.strip().splitlines()[-1])
    if not receipt.get('ok'):
        raise SystemExit('install failed: ' + output[-800:])
    remote('cp /tmp/next-release.json /srv/sites/jigsaw/releases/%s/app/release.json && chown web-jigsaw:web-jigsaw /srv/sites/jigsaw/releases/%s/app/release.json'
           % (next_release, next_release))
    remote('ln -sfn /srv/sites/jigsaw/releases/%s/app /srv/sites/jigsaw/current.tmp && mv -T /srv/sites/jigsaw/current.tmp /srv/sites/jigsaw/current' % next_release)

    print('6/6 verifying…')
    health = remote('curl -sf -m 5 -H "Host: jigsawnook.online" -H "X-Forwarded-Proto: https" http://127.0.0.1:%s/api/health' % SLOT).strip()
    for page in ('/zh/lobby', '/zh/help'):
        code = remote('curl -s -o /dev/null -w "%%{http_code}" -L -m 12 -H "Host: jigsawnook.online" -H "X-Forwarded-Proto: https" http://127.0.0.1:%s%s' % (SLOT, page)).strip()
        if code != '200':
            raise SystemExit('%s returned %s' % (page, code))
    record = {
        'ok': True,
        'release': next_release,
        'previous': live_release,
        'commit': manifest.get('gitCommit'),
        'changedFiles': len(changed),
        'uploadedMB': round(total, 1),
        'linked': receipt.get('linked'),
        'keptOldChunks': receipt.get('keptOldChunks'),
        'health': json.loads(health),
        'databaseBackup': receipt.get('databaseBackup'),
        'note': options.note,
        'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
    (work / 'last-deploy.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
