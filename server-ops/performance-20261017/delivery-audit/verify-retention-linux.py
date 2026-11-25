import os,pathlib,re,stat
SOURCE_SHA='6515826e4ca0c8cd656543283c87388ae20613ba87f76c312126e068dc6f3f0d'
SHARED_FILES = frozenset(['game.js', 'assets/audio/mobile-snap.wav', 'assets/ui/b2-core-icons23.png', 'assets/ui/b2-task-icons23.png', 'art/b2-supply-scenes.png', 'art/b2-pixel-atlas.png', 'assets/fonts/OFL-NotoSansSC.txt', 'assets/fonts/FONT-NOTICES.md', 'assets/fonts/jigsaw-ui-sc.woff2'])

def plain_directory(path):
    if path.is_symlink() or not stat.S_ISDIR(path.lstat().st_mode):
        raise ValueError('Expected a plain directory: ' + str(path))

def retain_shared_client_hashes(old_app, next_app):
    old_app, next_app = (pathlib.Path(old_app), pathlib.Path(next_app))
    old_root, next_root = (old_app, next_app)
    for segment in ('dist', 'client'):
        old_root, next_root = (old_root / segment, next_root / segment)
        plain_directory(old_root)
        plain_directory(next_root)
    old_root, next_root = (old_root / 'shared-client', next_root / 'shared-client')
    if old_root.is_symlink():
        raise ValueError('Linked shared-client root')
    if not old_root.exists():
        return 0
    plain_directory(old_root)
    if not next_root.exists() and (not next_root.is_symlink()):
        next_root.mkdir()
    plain_directory(next_root)
    retained = 0
    for source_hash in sorted(old_root.iterdir()):
        if not re.fullmatch('[a-f0-9]{16}', source_hash.name):
            raise ValueError('Invalid shared-client hash directory')
        plain_directory(source_hash)
        target_hash = next_root / source_hash.name
        if not target_hash.exists() and (not target_hash.is_symlink()):
            target_hash.mkdir()
        plain_directory(target_hash)

        def copy_plain(source_dir, relative=pathlib.PurePosixPath()):
            nonlocal retained
            for source in sorted(source_dir.iterdir()):
                rel = relative / source.name
                mode = source.lstat().st_mode
                if source.is_symlink():
                    raise ValueError('Linked shared-client entry')
                target = target_hash.joinpath(*rel.parts)
                if stat.S_ISDIR(mode):
                    if not any((name.startswith(rel.as_posix() + '/') for name in SHARED_FILES)):
                        raise ValueError('Unexpected shared-client directory')
                    if not target.exists() and (not target.is_symlink()):
                        target.mkdir()
                    plain_directory(target)
                    copy_plain(source, rel)
                elif stat.S_ISREG(mode):
                    if rel.as_posix() not in SHARED_FILES:
                        raise ValueError('Unexpected shared-client file')
                    if target.is_symlink():
                        raise ValueError('Linked shared-client destination')
                    if target.exists():
                        if not stat.S_ISREG(target.lstat().st_mode) or target.read_bytes() != source.read_bytes():
                            raise ValueError('Shared-client immutable collision')
                    else:
                        os.link(source, target)
                        retained += 1
                else:
                    raise ValueError('Special shared-client file')
        copy_plain(source_hash)
    return retained

import json,os,pathlib,re,stat,tempfile
RESULTS=[]
with tempfile.TemporaryDirectory(prefix='jigsaw-retention-check-')as folder:
 root=pathlib.Path(folder);old=root/'old';new=root/'new';hid='1234567890abcdef';other='fedcba0987654321'
 for base in(old,new):(base/'dist/client/shared-client').mkdir(parents=True)
 for name in SHARED_FILES:
  p=old/'dist/client/shared-client'/hid/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(('old:'+name).encode())
 fresh=new/'dist/client/shared-client'/other/'game.js';fresh.parent.mkdir();fresh.write_bytes(b'new client')
 assert retain_shared_client_hashes(old,new)==9 and fresh.read_bytes()==b'new client'
 a=old/'dist/client/shared-client'/hid/'game.js';b=new/'dist/client/shared-client'/hid/'game.js'
 assert a.stat().st_ino==b.stat().st_ino
 RESULTS.append({'check':'old hash files retained by hardlink and current version unchanged','passed':True})
 assert retain_shared_client_hashes(old,new)==0;RESULTS.append({'check':'idempotent same-byte retention','passed':True})
 original=a.read_bytes();b.unlink();b.write_bytes(b'collision')
 try:retain_shared_client_hashes(old,new);raise AssertionError('collision accepted')
 except ValueError:pass
 assert b.read_bytes()==b'collision'and a.read_bytes()==original
 b.unlink();os.link(a,b);RESULTS.append({'check':'immutable collision rejected without touching source or target','passed':True})
 bad=old/'dist/client/shared-client'/hid/'secret.env';bad.write_bytes(b'fixture only')
 try:retain_shared_client_hashes(old,new);raise AssertionError('non-allowlisted file accepted')
 except ValueError:pass
 bad.unlink();RESULTS.append({'check':'non-allowlisted file rejected','passed':True})
 a.unlink();a.symlink_to(fresh)
 try:retain_shared_client_hashes(old,new);raise AssertionError('source symlink accepted')
 except ValueError:pass
 a.unlink();a.write_bytes(original)
 b.unlink();b.symlink_to(fresh)
 try:retain_shared_client_hashes(old,new);raise AssertionError('target symlink accepted')
 except ValueError:pass
 RESULTS.append({'check':'real source and destination symlinks rejected','passed':True,'realSymlink':True})
print(json.dumps({'passed':True,'sourceSha256':SOURCE_SHA,'checks':RESULTS},indent=2))
