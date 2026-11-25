import pathlib,json,hashlib,sys,tarfile,io,os
from inspect import remote
here=pathlib.Path(__file__).resolve().parent;root=here.parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
data=remote('''import pathlib,json,hashlib
b=pathlib.Path('/srv/sites/jigsaw');c=(b/'current').resolve();records=[]
for p in (c/'dist/client').rglob('*'):
 if p.is_file():
  assert not p.is_symlink();records.append({'path':str(p.relative_to(c)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
print(json.dumps({'current':str(c),'files':records}))
''')
inspection=json.loads((here/'inspection.json').read_bytes());assert data['current']==inspection['current']
(here/'public-inventory.before.json').write_text(json.dumps(data,indent=2),encoding='utf8')
baseline=json.loads((here/'baseline-manifest.json').read_bytes());installed={f['path']:f for f in baseline['files']};installed.update({f['path']:f for f in data['files']})
target=json.loads((here/'target-manifest.json').read_bytes());files={f['path']:f for f in target['files']}
for f in data['files']:
 if f['path'] in files:
  if not f['path'].startswith('dist/client/.vite/'):assert files[f['path']]==f, 'Existing public resource collision: '+f['path']
 else:files[f['path']]=f
target['files']=sorted(files.values(),key=lambda f:f['path'])
target['runtimeAssets']=sorted(set(target['runtimeAssets'])|{f['path'][len('dist/client'):] for f in data['files'] if f['path'].startswith(('dist/client/puzzles/','dist/client/cosmetics/','dist/client/shared-client/'))})
target['verification']={'kind':'account-scoped-web-diagnostics','baselineManifestSha256':sha(here/'baseline-manifest.json'),'preserveAllInstalledPublicFiles':True}
body=(json.dumps(target,indent=2)+'\n').encode();(here/'target-manifest.json').write_bytes(body);(here/'runtime/release.json').write_bytes(body)
payload=[f for name,f in files.items() if installed.get(name)!=f]
with tarfile.open(here/'delta.tar.gz','w:gz',compresslevel=1) as tar:
 for f in payload:
  p=here/'runtime'/f['path'];assert p.stat().st_size==f['bytes'] and sha(p)==f['sha256'];info=tarfile.TarInfo(f['path']);info.size=f['bytes'];info.mode=0o644;tar.addfile(info,io.BytesIO(p.read_bytes()))
report={'deltaSha256':sha(here/'delta.tar.gz'),'manifestSha256':sha(here/'target-manifest.json'),'baseManifestSha256':sha(here/'baseline-manifest.json'),'publicFilesPreserved':len(data['files']),'payloadFiles':len(payload),'bytes':(here/'delta.tar.gz').stat().st_size,'commit':target['gitCommit']}
(here/'freeze.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
