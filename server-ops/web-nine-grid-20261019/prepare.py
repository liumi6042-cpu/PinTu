import pathlib,json,subprocess,os,hashlib,shutil
here=pathlib.Path(__file__).resolve().parent;project=here.parents[1];repo=project/'work/dual-managed-release-20261014';stage=here/'source'
manifest=json.loads((here/'baseline-manifest.json').read_bytes());base=manifest['gitCommit']
def git(*args,**kw):return subprocess.check_output(['git',*args],cwd=repo,**kw)
def tree(ref):
 out={}
 for row in git('ls-tree','-rz','--full-tree',ref).split(b'\0'):
  if row:
   meta,name=row.split(b'\t',1);mode,kind,sha=meta.decode().split();out[name.decode('utf8')]=(mode,sha)
 return out
assert not stage.exists();stage.mkdir();old=tree(base);head=tree('HEAD');count=0
for name,(mode,sha) in old.items():
 if name.split('/')[0] not in {'app','components','config','content','drizzle','hooks','lib','public','server','scripts','.openai'} and '/' in name:continue
 if name.startswith(('.env','.dev.vars')):continue
 target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);current=repo/name
 if head.get(name)==(mode,sha) and current.is_file():
  if name.startswith(('public/','content/artwork/')):os.link(current,target)
  else:shutil.copyfile(current,target)
 else:target.write_bytes(git('cat-file','blob',sha))
 count+=1
overlay=['lib/shared-client-api.ts','lib/shared-diagnostics.ts','lib/site-settings.ts','server/runtime.node.mjs','drizzle/0019_web_diagnostic_rooms.sql']
for name in overlay:
 target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(repo/name,target)
subprocess.run(['cmd','/c','mklink','/J',str(stage/'node_modules'),str(repo/'node_modules')],check=True,capture_output=True)
subprocess.run(['node',str(repo/'scripts/prepare-shared-client.mjs'),'--source='+str(project/'jigsaw-nook-taptap')],cwd=stage,check=True) if False else None
# Export targets import.meta.dirname, so execute the staged helper.
subprocess.run(['node','scripts/prepare-shared-client.mjs','--source='+str(project/'jigsaw-nook-taptap')],cwd=stage,check=True)
client=json.loads((stage/'app/shared-client-build.json').read_bytes())
index=here/'scope.index';env={**os.environ,'GIT_INDEX_FILE':str(index)}
subprocess.run(['git','read-tree',base],cwd=repo,env=env,check=True)
approved=overlay+['app/shared-client-build.json','config/runtime-assets.json']+[str(p.relative_to(stage)).replace('\\','/') for p in (stage/'public/shared-client'/client['id']).rglob('*') if p.is_file()]
for name in approved:
 blob=subprocess.check_output(['git','hash-object','-w','--stdin'],cwd=repo,input=(stage/name).read_bytes()).decode().strip()
 subprocess.run(['git','update-index','--add','--cacheinfo','100644',blob,name],cwd=repo,env=env,check=True)
treeid=subprocess.check_output(['git','write-tree'],cwd=repo,env=env).decode().strip()
commit=git('commit-tree',treeid,'-p',base,input=b'Add account-scoped Web nine-grid latency diagnostics\n').decode().strip()
subprocess.run(['git','update-ref','refs/heads/codex/web-nine-grid-20261019',commit],cwd=repo,check=True)
(here/'source-record.json').write_text(json.dumps({'base':base,'commit':commit,'source':str(stage),'approved':approved,'client':client,'files':count},indent=2),encoding='utf8')
print(json.dumps({'base':base,'commit':commit,'client':client,'files':count}))
