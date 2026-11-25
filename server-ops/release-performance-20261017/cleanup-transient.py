import pathlib,hashlib,json,shutil
base=pathlib.Path('/srv/sites/jigsaw')
assert (base/'current').resolve()==base/'releases/20261017-01/app'
assert (base/'releases/20261016-04/app/release.json').is_file()
assert json.loads((base/'releases/20261017-01/deployment.json').read_text())['contentPointerUnchanged'] is True
archive=pathlib.Path('/tmp/jigsaw-nook-968a76ca451afdcd.tar.gz')
assert archive.parent.resolve()==pathlib.Path('/tmp') and not archive.is_symlink() and archive.is_file()
expected='968a76ca451afdcde70afcf0b1b76f5dcf816acf5d0f6d01024aad8242f4652d'
with archive.open('rb') as file:
    assert hashlib.file_digest(file,'sha256').hexdigest()==expected
size=archive.stat().st_size
archive.unlink()
print(json.dumps({'removedTransientArchive':str(archive),'sha256':expected,'bytes':size,'rollbackAndBackupsPreserved':True,'diskFreeBytes':shutil.disk_usage(base).free}))
