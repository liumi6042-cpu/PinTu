"""Read-only project inventory, without traversing reparse points or links."""
import os,sys,json,gzip,time,stat,collections,pathlib
sys.stdout.reconfigure(encoding='utf-8')
root=pathlib.Path(r'D:\chat\拼图').resolve(strict=True)
out=root/'server-ops/cleanup-20261016'
out.mkdir(parents=True,exist_ok=True)
started=time.time();files=[];links=[];errors=[];dirs=collections.defaultdict(lambda:[0,0]);inodes={}
stack=[root];n=0
while stack:
 folder=stack.pop()
 try:
  with os.scandir(folder) as entries:
   for entry in entries:
    try:
     # Windows DirEntry.stat() reports zero for inode/link fields. A fresh
     # os.stat() is required to identify actual NTFS hardlink identities.
     info=os.stat(entry.path,follow_symlinks=False);rel=pathlib.Path(entry.path).relative_to(root).as_posix()
     if entry.is_symlink() or getattr(info,'st_file_attributes',0)&0x400:
      links.append({'path':rel,'directory':entry.is_dir(follow_symlinks=False)});continue
     if entry.is_dir(follow_symlinks=False):stack.append(pathlib.Path(entry.path));continue
     if not stat.S_ISREG(info.st_mode):continue
     if rel.startswith('server-ops/cleanup-20261016/'):continue
     key=str(info.st_dev)+':'+str(info.st_ino)
     files.append([rel,info.st_size,key,info.st_nlink,int(info.st_mtime)])
     if key not in inodes:inodes[key]=[info.st_size,info.st_nlink,1]
     else:inodes[key][2]+=1
     parts=rel.split('/')
     for count in range(1,len(parts)):
      value=dirs['/'.join(parts[:count])];value[0]+=info.st_size;value[1]+=1
     n+=1
     if n%100000==0:print(json.dumps({'filesScanned':n,'seconds':round(time.time()-started,1)}),flush=True)
    except OSError as e:errors.append({'path':entry.path,'error':str(e)})
 except OSError as e:errors.append({'path':str(folder),'error':str(e)})
with gzip.open(out/'files-before.json.gz','wt',encoding='utf-8',compresslevel=1) as target:
 json.dump({'root':str(root),'columns':['path','logicalBytes','fileIdentity','hardlinkCount','modifiedUnix'],'files':files},target,ensure_ascii=False,separators=(',',':'))
directory_rows=[{'path':name,'bytes':v[0],'files':v[1]} for name,v in dirs.items()]
directory_rows.sort(key=lambda x:x['bytes'],reverse=True)
summary={'root':str(root),'atUnix':int(time.time()),'elapsedSeconds':round(time.time()-started,2),'files':n,'directories':len(dirs),'logicalBytes':sum(x[1] for x in files),'uniqueFileBytes':sum(v[0] for v in inodes.values()),'uniqueFileIdentities':len(inodes),'hardlinkedIdentities':sum(v[1]>1 for v in inodes.values()),'outsideProjectHardlinks':sum(v[1]>v[2] for v in inodes.values()),'skippedLinks':links,'errors':errors,'topLevel':[{**row} for row in directory_rows if '/' not in row['path']],'largestDirectories':directory_rows[:120]}
with open(out/'inventory-before.json','w',encoding='utf-8') as target:json.dump(summary,target,ensure_ascii=False,indent=2)
with open(out/'directories-before.json','w',encoding='utf-8') as target:json.dump(directory_rows,target,ensure_ascii=False,separators=(',',':'))
print(json.dumps({k:v for k,v in summary.items() if k not in ['skippedLinks','errors','largestDirectories']},ensure_ascii=False),flush=True)
