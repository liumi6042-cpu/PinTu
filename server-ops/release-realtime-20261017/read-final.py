import pathlib,json,hashlib,subprocess,sqlite3,urllib.request,time,shutil,re
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def get(url,headers={}):
 with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=15) as r:
  assert r.status==200;return json.load(r)
base=pathlib.Path('/srv/sites/jigsaw');mb=pathlib.Path('/srv/sites/jigsaw-mobile-v3')
web=(base/'current').resolve(strict=True);mobile=(mb/'current').resolve(strict=True)
assert web==base/'releases/20261017-02/app';assert mobile==mb/'releases/20261017-realtime43'
assert (base/'releases/20261017-01/app/release.json').is_file();assert (mb/'releases/20261017-perf42/release.json').is_file()
assert sha(web/'release.json')=='f71edfc064ba2f5373ddb15947abd3b6565e16fab0b65b2756d8812dcc4ecf57'
assert sha(mobile/'release.json')=='8dc573bb5909842344466606f9ba0b0b7bff6269cd265bbb746a145ff7088720'
out={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'readOnly':True,'current':{'web':str(web),'mobile':str(mobile)},'rollbackPreserved':True,'services':{}}
for unit,want in [('jigsaw-web@3103.service','active'),('jigsaw-web@3104.service','inactive'),('jigsaw-mobile-v3.service','active'),('jigsaw-h5.service','active')]:
 value=subprocess.run(['systemctl','is-active',unit],capture_output=True,text=True).stdout.strip();assert value==want,(unit,value);out['services'][unit]=value
pointer=pathlib.Path('/srv/sites/jigsaw-content/current.json');published=json.loads(pointer.read_text());out['contentPointer']={'sha256':sha(pointer),'value':published}
assert published['releaseId']=='release-20261016T191737757Z-4ba6feec'
out['health']={'web':get('http://127.0.0.1:3103/api/health',{'Host':'jigsawnook.online','X-Forwarded-Proto':'https'}),'mobile':get('http://127.0.0.1:3292/healthz')}
assert all(h['contentReleaseId']==published['releaseId'] for h in out['health'].values())
out['contentChecks']={}
for label,root in [('web',web),('mobile',mobile)]:
 data=json.loads(run('runuser','-u','web-jigsaw','--','env','JIGSAW_CONTENT_RELEASE_DIR=/srv/sites/jigsaw-content/releases/'+published['releaseId'],'JIGSAW_CONTENT_RELEASE_ID='+published['releaseId'],'JIGSAW_CONTENT_MANIFEST_SHA256='+published['manifestSha256'],'/usr/local/bin/node',str(root/'scripts/check-content-release.mjs')))
 assert data['ok'] and data['contentReleaseId']==published['releaseId'];out['contentChecks'][label]=data
nginx=pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').read_bytes()
prior=pathlib.Path('/srv/sites/jigsaw/shared/backups/realtime-nginx-1792178777/after.conf').read_bytes()
assert hashlib.sha256(prior).hexdigest()=='b7fbc939e742376e4cf27631580f8154ebd5b4b25836cfe3465886e5b9f37d4d'
assert nginx==prior.replace(b'http://127.0.0.1:3104',b'http://127.0.0.1:3103')
out['nginx']={'sha256':hashlib.sha256(nginx).hexdigest(),'twoExactWsRoutes':True,'otherRulesPreserved':True}
def dbcheck(p):
 with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=10) as db:
  check=db.execute('PRAGMA quick_check').fetchone()[0];assert check=='ok'
  return {'path':str(p),'inode':p.stat().st_ino,'bytes':p.stat().st_size,'quickCheck':check,'journalMode':db.execute('PRAGMA journal_mode').fetchone()[0]}
out['databases']=[dbcheck(pathlib.Path(p)) for p in ['/srv/sites/jigsaw/shared/puzzle.sqlite','/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite','/srv/sites/jigsaw-mobile-v3/shared/sessions.sqlite']]
assert [d['inode'] for d in out['databases']]==[697010,673977,673980]
latest=sorted((base/'shared/backups').glob('jigsaw-*.sqlite'))[-1];backup=json.loads(pathlib.Path(str(latest)+'.json').read_text())
assert backup['file']==latest.name and backup['integrity']=='ok' and sha(latest)==backup['sha256'];assert backup['createdAt']>='2026-10-16T19:00:00'
out['backups']={'web':{**backup,'path':str(latest),'quickCheck':dbcheck(latest)['quickCheck']},'mobile':json.loads((mobile/'deployment/backup.json').read_text())}
for entry in out['backups']['mobile']['databases']:
 p=mb/'shared'/entry['path'];assert p.is_file() and sha(p)==entry['sha256'] and p.stat().st_size==entry['bytes'];assert dbcheck(p)['quickCheck']=='ok'
out['recentDatabaseErrors']={}
for unit in ['jigsaw-web@3103.service','jigsaw-mobile-v3.service']:
 logs=run('journalctl','-u',unit,'--since','10 minutes ago','--no-pager','-q','-o','cat','-n','1000')
 count=len(re.findall(r'SQLITE_BUSY|SQLITE_LOCKED|database is locked|SQLITE_FULL|database or disk is full',logs,re.I));assert count==0
 out['recentDatabaseErrors'][unit]={'maxLines':1000,'matched':count}
out['disk']=dict(zip(['total','used','free'],shutil.disk_usage('/srv/sites')));out['passed']=True
print(json.dumps(out))
