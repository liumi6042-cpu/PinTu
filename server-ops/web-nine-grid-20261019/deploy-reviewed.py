"""Scoped Web release: retain every installed public resource, isolate QA, then
back up SQLite and environment, enable one account and switch the existing slot.
Rollback restores code/routing/environment only, never old player data.
"""
import pathlib,hashlib,json,os,shlex,subprocess,sqlite3,tarfile,shutil,tempfile,time,urllib.request,urllib.error,signal
ROOT=pathlib.Path('/srv/sites/jigsaw');HERE=pathlib.Path('/tmp/web-nine-grid-20261019');RELEASE='web-20261019-nine-grid'
freeze=json.loads((HERE/'freeze.json').read_bytes());baseline=(HERE/'baseline-manifest.json').read_bytes();inspection=json.loads((HERE/'inspection.json').read_bytes())
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=(ROOT/'current').resolve();assert str(old)==inspection['current'];assert (old/'release.json').read_bytes()==baseline
slot=ROOT/'slots/3104';assert slot.resolve()==old;assert subprocess.check_output(['systemctl','is-active','jigsaw-web@3104.service'],text=True).strip()=='active'
pointer=pathlib.Path('/srv/sites/jigsaw-content/current.json');pointer_before=pointer.read_bytes();assert hashlib.sha256(pointer_before).hexdigest()==inspection['contentPointerSha256']
assert digest(HERE/'delta.tar.gz')==freeze['deltaSha256'];assert digest(HERE/'target-manifest.json')==freeze['manifestSha256']
manifest=json.loads((HERE/'target-manifest.json').read_bytes());assert manifest['gitCommit']==freeze['commit'] and manifest['dirty'] is False
files={f['path']:f for f in manifest['files']};public=json.loads((HERE/'public-inventory.before.json').read_bytes())['files']
for f in public:
 assert digest(old/f['path'])==f['sha256']
old_migrations={p.name:digest(p) for p in (old/'drizzle').glob('*.sql')};next_migrations={pathlib.PurePosixPath(n).name:f['sha256'] for n,f in files.items() if n.startswith('drizzle/') and n.endswith('.sql')}
assert {k:v for k,v in next_migrations.items() if k in old_migrations}==old_migrations
assert set(next_migrations)-set(old_migrations)=={'0019_web_diagnostic_rooms.sql'}
release=ROOT/'releases'/RELEASE;app=release/'app';app.mkdir(parents=True,exist_ok=True)
if (app/'release.json').exists():assert (app/'release.json').read_bytes()==(HERE/'target-manifest.json').read_bytes()
for name,f in files.items():
 p=pathlib.PurePosixPath(name);assert str(p)==name and not p.is_absolute() and '..' not in p.parts and '\\' not in name
 source=old/name;target=app/name;target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists():assert target.is_file() and not target.is_symlink() and digest(target)==f['sha256'];continue
 if source.is_file() and not source.is_symlink() and source.stat().st_size==f['bytes'] and digest(source)==f['sha256']:os.link(source,target)
with tarfile.open(HERE/'delta.tar.gz') as tar:
 for member in tar:
  assert member.isfile() and member.name in files
  target=app/member.name
  if target.exists():assert digest(target)==files[member.name]['sha256'];continue
  with tar.extractfile(member) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
for name,f in files.items():assert (app/name).is_file() and (app/name).stat().st_size==f['bytes'] and digest(app/name)==f['sha256'],name
(app/'release.json').write_bytes((HERE/'target-manifest.json').read_bytes())
for f in public:
 if not f['path'].startswith('dist/client/.vite/'):assert digest(app/f['path'])==f['sha256']
envfile=pathlib.Path('/etc/webapps/jigsaw.env');env_before=envfile.read_bytes();settings={}
for line in env_before.decode().splitlines():
 if '=' in line and not line.startswith('#'):
  key,value=line.split('=',1);values=shlex.split(value,comments=False);settings[key]=values[0] if values else ''
database=pathlib.Path(settings['DATABASE_PATH']);assert database==ROOT/'shared/puzzle.sqlite'
source=sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True)
accounts=source.execute('SELECT id,username,name FROM puzzle_users WHERE username=?',('devgod',)).fetchall();assert len(accounts)==1 and accounts[0][2]=='羊咩咩'
actor=accounts[0][0];assert len(actor)==32 and all(c in '0123456789abcdef' for c in actor)
base_env={**os.environ,**settings,'NODE_ENV':'production','HOST':'127.0.0.1','PORT':'3138','VINEXT_TRUSTED_HOSTS':'jigsawnook.online','VINEXT_TRUST_PROXY':'1','PUZZLE_PUBLIC_ORIGIN':'https://jigsawnook.online','PUZZLE_BETA_CAPACITY':'0','PUZZLE_REALTIME_ENABLED':'1','MIGRATIONS_DIR':str(app/'drizzle')}
http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
secret='c'*64;test_actor='a'*32
def request(path,body=None,token=None,cookie=secret,port=3138):
 headers={'Host':'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https','Origin':'https://jigsawnook.online','X-Jigsaw-Artwork-Snapshot':'1','Cookie':'puzzle_session='+cookie}
 if body is not None:headers['Content-Type']='application/json'
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request('http://127.0.0.1:'+str(port)+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 try:
  with http.open(req,timeout=10) as res:return res.status,res.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def ready(port):
 for _ in range(70):
  try:
   status,body=request('/api/health',port=port);data=json.loads(body)
   if status==200 and data.get('ok') is True and data.get('contentReleaseId')==json.loads(pointer_before)['releaseId']:return data
  except Exception:pass
  time.sleep(.2)
 raise RuntimeError('Service health did not become ready')
qa=release/('qa-'+str(time.time_ns()));qa.mkdir(mode=0o700);qa_db=qa/'puzzle.sqlite'
# Synthetic players only; production sessions are never copied to QA.
qa_env={**base_env,'DATABASE_PATH':str(qa_db),'JIGSAW_DAILY_APPEARANCES_DIR':str(qa/'appearances'),'PUZZLE_DIAGNOSTIC_ACCOUNT_IDS':test_actor}
script="import {SqliteD1} from './server/sqlite.mjs';const db=new SqliteD1(process.env.DATABASE_PATH,'drizzle');const now=Date.now();db.sql.prepare('INSERT INTO puzzle_users VALUES(?,?,?,?,?,?)').run('a'.repeat(32),'diagnosticqa','诊断验收','not-a-password','not-a-salt',now);const {createHash}=await import('node:crypto');db.sql.prepare('INSERT INTO puzzle_sessions VALUES(?,?,?)').run(createHash('sha256').update('c'.repeat(64)).digest('hex'),'a'.repeat(32),now+3600000);db.close();"
subprocess.run(['/usr/local/bin/node','--input-type=module','-e',script],cwd=app,env=qa_env,check=True,capture_output=True)
log=(qa/'server.log').open('wb');process=subprocess.Popen(['/usr/local/bin/node','server.js'],cwd=app,env=qa_env,stdout=log,stderr=log,start_new_session=True)
try:
 ready(3138)
 status,body=request('/api/shared/api/mobile/profile');assert status==200,body;profile=json.loads(body);assert profile['diagnostics'] is True
 db=sqlite3.connect('file:'+str(qa_db)+'?mode=ro',uri=True);wallet_before=db.execute('SELECT data FROM puzzle_managed_players WHERE owner=?',(test_actor,)).fetchone()
 status,body=request('/api/shared/api/mobile/diagnostics/room',{'requestId':'e'*32});assert status==201,body;ticket=json.loads(body);assert ticket['room']['diagnostic'] and ticket['room']['puzzle']['cols']==3
 assert ticket['room'].get('photo',{}).get('src')
 status,replayed=request('/api/shared/api/mobile/diagnostics/room',{'requestId':'e'*32});assert status==200 and json.loads(replayed)['room']['id']==ticket['room']['id']
 path='/api/shared/api/rooms/'+ticket['room']['id'];token=ticket['token']
 assert request(path,token=token,cookie='d'*64)[0]==403
 for n in range(9):
  for action in [{'type':'claim','groupId':n},{'type':'move','groupId':n,'dx':20,'dy':20,'seq':1},{'type':'drop','groupId':n,'dx':0,'dy':0,'seq':2}]:
   status,body=request(path+'?since=0',action,token);assert status==200,body
   assert json.loads(body)['diagnosticTiming']['serverMs']>=0
 result=json.loads(request(path,token=token)[1]);assert result['completedAt'] and sum(len(g['pieces']) for g in result['puzzle']['groups'] if g['locked'])==9
 assert db.execute('SELECT data FROM puzzle_managed_players WHERE owner=?',(test_actor,)).fetchone()==wallet_before
 for table in ['puzzle_rooms','puzzle_room_directory','puzzle_managed_reward_events','puzzle_piece_progress','puzzle_piece_daily_events','puzzle_results']:assert db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]==0,table
 status,body=request('/api/shared/api/mobile/diagnostics/room',{'requestId':'f'*32});assert status==201 and json.loads(body)['room']['id']!=ticket['room']['id'];assert request(path,token=token)[0]==410
 db.close()
 status,page=request('/play');assert status==200 and b'bb55eb8378ab32aa' in page
 status,config=request('/api/shared/config');config=json.loads(config);assert status==200 and config['identityMode']=='web-cookie' and config['capabilities']['energy'] is False
 assert pointer.read_bytes()==pointer_before
except BaseException:
 print((qa/'server.log').read_text(errors='replace')[-2000:]);raise
finally:
 os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=10);log.close()
print(json.dumps({'stage':'isolated-qa-passed','nineActualDrops':True,'walletUnchanged':True,'publicFilesPreserved':len(public)}),flush=True)
assert (ROOT/'current').resolve()==old and slot.resolve()==old and envfile.read_bytes()==env_before and pointer.read_bytes()==pointer_before
backup=ROOT/'shared/operations'/RELEASE;backup.mkdir(parents=True,mode=0o700);os.chmod(backup,0o700)
(backup/'environment.before').write_bytes(env_before);os.chmod(backup/'environment.before',0o600)
target=sqlite3.connect(str(backup/'puzzle.sqlite'));source.backup(target);target.close();source.close();os.chmod(backup/'puzzle.sqlite',0o600)
allowed=set(filter(None,settings.get('PUZZLE_DIAGNOSTIC_ACCOUNT_IDS','').split(',')));allowed.add(actor)
line='PUZZLE_DIAGNOSTIC_ACCOUNT_IDS='+','.join(sorted(allowed))+'\n'
env_after=''.join(s for s in env_before.decode().splitlines(keepends=True) if not s.startswith('PUZZLE_DIAGNOSTIC_ACCOUNT_IDS='))
if env_after and not env_after.endswith('\n'):env_after+='\n'
env_after=(env_after+line).encode()
def write_env(data):
 temporary=envfile.with_name(envfile.name+'.nine-grid.tmp');st=envfile.stat();temporary.write_bytes(data);os.chmod(temporary,st.st_mode);os.chown(temporary,st.st_uid,st.st_gid);os.replace(temporary,envfile)
def point(link,target):
 temporary=link.with_name(link.name+'.nine-grid.tmp');assert not temporary.exists() and not temporary.is_symlink();os.symlink(str(target),temporary);os.replace(temporary,link)
subprocess.run(['chown','-R','web-jigsaw:web-jigsaw',str(app)],check=True)
try:
 write_env(env_after);point(slot,app);subprocess.run(['systemctl','restart','jigsaw-web@3104.service'],check=True)
 health=ready(3104);assert pointer.read_bytes()==pointer_before
 status,config=request('/api/shared/config',port=3104);assert status==200 and json.loads(config)['uiBase']=='/shared-client/bb55eb8378ab32aa/'
 assert request('/play',port=3104)[0]==200
 point(ROOT/'current',app)
except BaseException:
 point(slot,old);write_env(env_before);subprocess.run(['systemctl','restart','jigsaw-web@3104.service'],check=True);ready(3104);raise
assert (ROOT/'current').resolve()==app and slot.resolve()==app
report={'ok':True,'release':RELEASE,'previous':str(old),'slot':3104,'commit':manifest['gitCommit'],'accountMatched':True,'whitelistUpdated':True,'isolatedQA':True,'publicFilesPreserved':len(public),'contentPointerUnchanged':pointer.read_bytes()==pointer_before,'health':health,'backup':str(backup),'rollback':'Restore previous slot/current and environment; keep current player database.'}
(release/'deployment.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
