#!/usr/bin/env python3
"""Apply one delivered artwork batch to the shared asset directory.

The batch directory must contain manifest.json:

  {"files": [{"url": "/puzzles/x.webp", "bytes": 123, "sha256": "..."}],
   "catalog": "catalog.json",          # optional, relative to the batch
   "guidance": "guidance.json",        # optional
   "mobileManifest": true}             # append missing URLs to h5/asset-manifest.json

Every file is verified against its recorded size and SHA-256 before anything is
published. Artwork is append-only: an existing different file is a hard error.
Static copies on both runtimes are hard links to the shared file, so a later
release switch only needs to re-link, never re-upload.

Exit code 0 means every requested action succeeded and the receipt was written.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ASSETS = '/srv/sites/jigsaw-content/assets'
PUZZLE_DIR = os.path.join(ASSETS, 'puzzles')
WEB_CURRENT = '/srv/sites/jigsaw/current'
MOBILE_CURRENT = '/srv/sites/jigsaw-mobile-v3/current'
WEB_UNIT = 'jigsaw-web@3104.service'
MOBILE_UNITS = ['jigsaw-mobile-v3.service', 'jigsaw-h5.service']
OWNER = ('web-jigsaw', 'web-jigsaw')


def fail(message):
    print(json.dumps({'ok': False, 'code': 'BATCH_INVALID', 'message': message}, ensure_ascii=False))
    sys.exit(2)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def owner_ids():
    try:
        import pwd
        import grp
        return pwd.getpwnam(OWNER[0]).pw_uid, grp.getgrnam(OWNER[1]).gr_gid
    except Exception:
        return None


def safe_name(url):
    if not url.startswith('/puzzles/'):
        fail('asset url must live under /puzzles/: ' + url)
    name = url[len('/puzzles/'):]
    if (not name or '/' in name or '\\' in name or name in ('.', '..')
            or any(ch not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-' for ch in name)):
        fail('unsafe asset name: ' + url)
    return name


def atomic_install(source, destination):
    """Copy into place with a temporary name, then rename (append-only)."""
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.incoming-', dir=os.path.dirname(destination))
    os.close(handle)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o644)
        ids = owner_ids()
        if ids:
            os.chown(temporary, *ids)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def link_into(release_file, shared_file):
    """Point a runtime static path at the shared file. Never replaces differing bytes."""
    os.makedirs(os.path.dirname(release_file), exist_ok=True)
    if os.path.exists(release_file):
        if os.path.islink(release_file) or os.path.getsize(release_file) == os.path.getsize(shared_file):
            if sha256_file(release_file) == sha256_file(shared_file):
                if not os.path.islink(release_file):
                    # Replace an identical plain file with a link so future batches stay cheap.
                    try:
                        os.unlink(release_file)
                        os.link(shared_file, release_file)
                    except OSError:
                        pass
                return 'identical'
        fail('runtime already has different bytes: ' + release_file)
    try:
        os.link(shared_file, release_file)
        return 'linked'
    except OSError:
        shutil.copyfile(shared_file, release_file)
        os.chmod(release_file, 0o644)
        return 'copied'


def current_app(symlink):
    real = os.path.realpath(symlink)
    if not os.path.isdir(real):
        fail('missing release directory: ' + real)
    return real


def install_manifest_entries(mobile_root, urls):
    path = os.path.join(mobile_root, 'h5', 'asset-manifest.json')
    with open(path, 'r', encoding='utf-8') as handle:
        entries = json.load(handle)
    if not isinstance(entries, list):
        fail('mobile asset manifest is not a list')
    added = [url for url in urls if url not in entries]
    if not added:
        return 0
    next_entries = entries + added
    temporary = path + '.tmp-' + str(os.getpid())
    with open(temporary, 'w', encoding='utf-8') as handle:
        json.dump(next_entries, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    ids = owner_ids()
    if ids:
        os.chown(temporary, *ids)
    os.replace(temporary, path)
    return len(added)


def restart(units):
    results = []
    for unit in units:
        completed = subprocess.run(['systemctl', 'restart', unit], capture_output=True, text=True)
        results.append({'unit': unit, 'code': completed.returncode,
                        'stderr': completed.stderr.strip()[:400]})
        if completed.returncode != 0:
            fail('service restart failed: ' + unit)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--restart', action='store_true')
    parser.add_argument('--list-existing', action='store_true')
    options = parser.parse_args()

    if not options.list_existing and not options.batch:
        fail('--batch is required')
    if options.list_existing:
        names = sorted(os.listdir(PUZZLE_DIR)) if os.path.isdir(PUZZLE_DIR) else []
        print(json.dumps({'ok': True, 'puzzles': names,
                          'catalog': os.path.exists(os.path.join(ASSETS, 'catalog.json')),
                          'guidance': os.path.exists(os.path.join(ASSETS, 'guidance.json'))},
                         ensure_ascii=False))
        return

    batch = os.path.realpath(options.batch)
    manifest_path = os.path.join(batch, 'manifest.json')
    if not os.path.isfile(manifest_path):
        fail('missing manifest.json in batch')
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    files = manifest.get('files')
    if not isinstance(files, list):
        fail('manifest.files must be a list')
    # A batch may carry only registry documents: renaming pictures, for example,
    # changes the catalogue but no image bytes. Such a batch is still valid.
    if not files and not (manifest.get('catalog') or manifest.get('guidance')):
        fail('a batch without files must update the catalogue or the guidance')

    assets_dir = os.path.join(batch, 'assets')
    verified = []
    for item in files:
        name = safe_name(item.get('url', ''))
        source = os.path.join(assets_dir, name)
        if not os.path.isfile(source):
            fail('batch is missing ' + name)
        size = os.path.getsize(source)
        if size != item.get('bytes'):
            fail('size mismatch for ' + name)
        if sha256_file(source) != item.get('sha256'):
            fail('hash mismatch for ' + name)
        verified.append({'name': name, 'source': source, 'bytes': size, 'sha256': item['sha256']})

    catalog_path = guidance_path = None
    for key in ('catalog', 'guidance'):
        name = manifest.get(key)
        if not name:
            continue
        source = os.path.join(batch, name)
        if not os.path.isfile(source):
            fail('missing ' + key + ' file in batch')
        with open(source, 'r', encoding='utf-8') as handle:
            json.load(handle)
        if key == 'catalog':
            catalog_path = source
        else:
            guidance_path = source

    plan = {'files': len(verified), 'bytes': sum(item['bytes'] for item in verified),
            'catalog': bool(catalog_path), 'guidance': bool(guidance_path),
            'apply': options.apply}
    if not options.apply:
        print(json.dumps({'ok': True, 'mode': 'dry-run', 'plan': plan}, ensure_ascii=False))
        return

    os.makedirs(PUZZLE_DIR, exist_ok=True)
    web_app = current_app(WEB_CURRENT)
    mobile_root = current_app(MOBILE_CURRENT)
    web_static = os.path.join(web_app, 'dist', 'client', 'puzzles')
    mobile_static = os.path.join(mobile_root, 'public', 'puzzles')

    installed = []
    for item in verified:
        shared = os.path.join(PUZZLE_DIR, item['name'])
        if os.path.exists(shared):
            if sha256_file(shared) != item['sha256']:
                fail('shared asset already exists with different bytes: ' + item['name'])
        else:
            atomic_install(item['source'], shared)
        if sha256_file(shared) != item['sha256']:
            fail('installed copy failed verification: ' + item['name'])
        installed.append({'name': item['name'],
                          'web': link_into(os.path.join(web_static, item['name']), shared),
                          'mobile': link_into(os.path.join(mobile_static, item['name']), shared)})

    if catalog_path:
        atomic_install(catalog_path, os.path.join(ASSETS, 'catalog.json'))
    if guidance_path:
        atomic_install(guidance_path, os.path.join(ASSETS, 'guidance.json'))

    manifest_added = 0
    if manifest.get('mobileManifest'):
        manifest_added = install_manifest_entries(mobile_root, ['/puzzles/' + item['name'] for item in verified])

    services = None
    if options.restart:
        services = restart([WEB_UNIT] + MOBILE_UNITS)

    receipt = {'schema': 'jigsaw-asset-delivery-receipt/v1', 'ok': True, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'files': len(installed), 'bytes': sum(item['bytes'] for item in verified),
               'catalog': bool(catalog_path), 'guidance': bool(guidance_path),
               'mobileManifestAdded': manifest_added, 'services': services, 'installed': installed}
    receipt_path = os.path.join(ASSETS, 'receipts', time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + str(os.getpid()) + '.json')
    os.makedirs(os.path.dirname(receipt_path), exist_ok=True)
    with open(receipt_path, 'w', encoding='utf-8') as handle:
        json.dump(receipt, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
