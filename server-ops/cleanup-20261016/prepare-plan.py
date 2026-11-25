"""Create a checked deletion manifest and preserve release metadata. No deletion."""
import os,json,gzip,pathlib,subprocess,hashlib,zipfile,collections,shutil,time
root=pathlib.Path(r'D:\chat\拼图').resolve(strict=True);out=pathlib.Path(__file__).resolve().parent
def load(name):return json.loads((out/name).read_text(encoding='utf-8-sig'))
raw=[]
for name in ['candidates-web.json','candidates-assets.json','candidates-games.json']:
 value=load(name);raw.extend(value if isinstance(value,list) else value['candidates'])
def key(p):return os.path.normcase(os.path.normpath(str(p)))
def child(p,parent):return key(p).startswith(key(parent)+os.sep)
def linked(p):return bool(getattr(os.lstat(p),'st_file_attributes',0)&0x400) or p.is_symlink()
items={};excluded=[]
for item in raw:
 p=pathlib.Path(item['path']);assert p.is_absolute() and child(p,root)
 assert p.exists() and p.resolve(strict=True)==p and not linked(p),str(p)
 rel=p.relative_to(root).as_posix();assert '.git' not in p.relative_to(root).parts
 if 'node_modules' in p.relative_to(root).parts:
  excluded.append({'path':str(p),'reason':'Preserve installed dependencies; formal Web checkout links to original puzzle-play dependencies.'});continue
 item={**item,'path':str(p),'relativePath':rel,'kind':'directory' if p.is_dir() else 'file'}
 items[key(p)]=item
selected=[]
for item in sorted(items.values(),key=lambda i:len(i['path'])):
 if not any(child(item['path'],v['path']) for v in selected):selected.append(item)
selected_by_key={key(v['path']):v for v in selected}
def owner(p):
 value=key(p)
 while value!=key(root) and value:
  if value in selected_by_key:return selected_by_key[value]
  parent=os.path.dirname(value)
  if parent==value:break
  value=parent
 return None
protection=load('keep-protection.json');protected=[]
def visit(v):
 if isinstance(v,dict):
  if isinstance(v.get('path'),str):protected.append(v['path'])
  for x in v.values():visit(x)
 elif isinstance(v,list):
  for x in v:visit(x)
visit(protection)
for p in protected:assert owner(p) is None,'Protected file selected: '+p
repos=['.','puzzle-play','jigsaw-nook-taptap','puzzle-play-taptap-route','work/dual-managed-release-20261014','work/publish-20261012'];git=[]
for name in repos:
 repo=root/name
 if not (repo/'.git').exists():continue
 tracked=subprocess.check_output(['git','-C',str(repo),'ls-files','-z']).decode('utf-8').split('\0')
 for relative in filter(None,tracked):assert owner(repo/relative) is None,'Tracked source selected: '+str(repo/relative)
 git.append({'path':str(repo),'head':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()})
with gzip.open(out/'files-before.json.gz','rt',encoding='utf-8') as f:inventory=json.load(f)
identities={};reclaimed=0;logical=0;file_count=0;manifests=[]
for rel,size,identity,nlink,modified in inventory['files']:
 entry=identities.setdefault(identity,{'size':size,'links':nlink,'selected':0,'scanned':0})
 entry['scanned']+=1
 hit=owner(root/rel)
 if not hit:continue
 assert '/.git/' not in '/'+rel and not rel.endswith('/.git'), 'Git metadata selected'
 logical+=size;file_count+=1;entry['selected']+=1
 hit['logicalBytes']=hit.get('logicalBytes',0)+size;hit['files']=hit.get('files',0)+1
 if pathlib.PurePosixPath(rel).name=='release.json' and size<2*1024*1024:manifests.append(rel)
for v in identities.values():
 if v['selected']==v['links']:reclaimed+=v['size']
archive=out/'retained-stage-manifests.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for rel in manifests:
  source=root/rel
  if source.is_file() and not linked(source):z.write(source,arcname=rel)
summary=load('inventory-before.json');links=[]
for link in summary['skippedLinks']:
 p=root/link['path']
 if owner(p):links.append({'path':str(p),'directory':link['directory']})
free=shutil.disk_usage(root).free
plan={'schema':'jigsaw-reviewed-cleanup/v1','createdAtUnix':int(time.time()),'root':str(root),'authorization':'User explicitly requested cleanup and deletion throughout this project directory.','beforeFreeBytes':free,'beforeLogicalBytes':summary['logicalBytes'],'beforeUniqueFileBytes':summary['uniqueFileBytes'],'candidates':selected,'excluded':excluded,'linksToUnlinkWithoutFollowing':links,'logicalBytesSelected':logical,'filesSelected':file_count,'estimatedReclaimableFileBytes':reclaimed,'preservedManifestArchive':str(archive),'preservedManifestCount':len(manifests),'protectedFileCount':len(protected),'trackedFilesProtected':True,'gitHeads':git}
(out/'cleanup-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in plan.items() if k not in ['candidates','linksToUnlinkWithoutFollowing','gitHeads']},ensure_ascii=True))
