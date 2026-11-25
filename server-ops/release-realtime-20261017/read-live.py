import pathlib,json,hashlib,subprocess,base64,sqlite3,time,shutil
def sha(data): return hashlib.sha256(data).hexdigest()
def run(*args): return subprocess.run(args,capture_output=True,text=True,check=True).stdout.strip()
roots={'web':pathlib.Path('/srv/sites/jigsaw/current').resolve(strict=True),'mobile':pathlib.Path('/srv/sites/jigsaw-mobile-v3/current').resolve(strict=True)}
out={'readOnly':True,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'current':{},'services':{},'files':{},'databases':[]}
for label,path in roots.items():
 out['current'][label]=str(path)
 data=(path/'release.json').read_bytes();manifest=json.loads(data)
 out['files'][label+'/release.json']={'sha256':sha(data),'base64':base64.b64encode(data).decode()}
for name,path in [('nginx','/etc/nginx/sites-enabled/jigsawnook.online.conf'),('content-pointer','/srv/sites/jigsaw-content/current.json')]:
 p=pathlib.Path(path);data=p.read_bytes();out['files'][name]={'path':str(p.resolve()),'sha256':sha(data),'base64':base64.b64encode(data).decode()}
for unit in ['jigsaw-web@3103.service','jigsaw-web@3104.service','jigsaw-mobile-v3.service','jigsaw-h5.service']:
 out['services'][unit]=run('systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','WorkingDirectory')
for name in ['/srv/sites/jigsaw/shared/puzzle.sqlite','/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite','/srv/sites/jigsaw-mobile-v3/shared/sessions.sqlite']:
 p=pathlib.Path(name)
 with sqlite3.connect(p.as_uri()+'?mode=ro',uri=True,timeout=10) as db:
  out['databases'].append({'path':name,'inode':p.stat().st_ino,'bytes':p.stat().st_size,'quickCheck':db.execute('PRAGMA quick_check').fetchone()[0],'journalMode':db.execute('PRAGMA journal_mode').fetchone()[0]})
out['disk']=dict(zip(['total','used','free'],shutil.disk_usage('/srv/sites')))
print(json.dumps(out))
