import base64,gzip,hashlib,http.client,json,os,pathlib,shutil,stat,subprocess,tempfile,time,urllib.request
PLAN=__PLAN__
sha=lambda b:hashlib.sha256(b).hexdigest()
p=pathlib.Path(PLAN['expectedPath']);old=p.read_bytes();new=base64.b64decode(PLAN['contentBase64']);info=p.stat()
assert str(p.resolve())==PLAN['expectedPath'] and p.is_file() and not p.is_symlink()
assert sha(old)==PLAN['expectedSha256'] and sha(new)==PLAN['newSha256'],'Site configuration changed'
assert os.path.realpath('/srv/sites/jigsaw/current')==PLAN['expectedCurrent'],'Application release changed'
def app_health(port,path):
 q=urllib.request.Request('http://127.0.0.1:'+str(port)+path,headers={'Host':'jigsawnook.online','X-Forwarded-Proto':'https'})
 with urllib.request.urlopen(q,timeout=15)as r:return json.loads(r.read())
before={'web':app_health(3103,'/api/health'),'mobile':app_health(3292,'/healthz')}
script=pathlib.Path(PLAN['expectedCurrent'])/'dist/client'/PLAN['scriptPath'].lstrip('/')
assert sha(script.read_bytes())==PLAN['scriptSha256'],'Client script changed'
backup=pathlib.Path('/srv/sites/jigsaw/shared/backups')/('delivery-cache-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()))
backup.mkdir(mode=0o700,exist_ok=False);shutil.copy2(p,backup/'nginx-before.conf')
(backup/'plan.json').write_text(json.dumps({k:v for k,v in PLAN.items()if k!='contentBase64'},indent=2))
def replace(data):
 fd,tmp=tempfile.mkstemp(prefix='.jigsaw-delivery-',dir=p.parent)
 try:
  with os.fdopen(fd,'wb')as h:os.fchown(h.fileno(),info.st_uid,info.st_gid);os.fchmod(h.fileno(),stat.S_IMODE(info.st_mode));h.write(data);h.flush();os.fsync(h.fileno())
  os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def command(args):
 r=subprocess.run(args,capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr or r.stdout or str(args))
 return (r.stdout+r.stderr).strip()
def probe(path,enc='identity'):
 r=subprocess.run(['curl','--silent','--show-error','--max-time','15','--resolve','jigsawnook.online:443:127.0.0.1','--header','Accept-Encoding: '+enc,'--dump-header','-','https://jigsawnook.online'+path],capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr.decode())
 header,body=r.stdout.split(b'\r\n\r\n',1);lines=header.decode().splitlines();headers={k.strip().lower():v.strip()for k,v in(s.split(':',1)for s in lines[1:]if ':'in s)}
 return {'path':path,'acceptEncoding':enc,'status':int(lines[0].split()[1]),'headers':headers,'bytes':len(body),'bodySha256':sha(body)},body
changed=False
try:
 assert p.read_bytes()==old,'Configuration changed during preparation';replace(new);changed=True
 syntax=command(['nginx','-t']);command(['systemctl','reload','nginx'])
 # Reload returns after signalling the master; wait for a new worker to serve it.
 for attempt in range(20):
  warm,_=probe(PLAN['scriptPath'])
  if warm['status']==200 and warm['headers'].get('cache-control')=='public, max-age=31536000, immutable':break
  time.sleep(.2)
 else:raise AssertionError('New static policy was not observed: '+json.dumps(warm))
 checks=[]
 for enc in ['identity','gzip']:
  x,body=probe(PLAN['scriptPath'],enc);checks.append(x)
  assert x['status']==200 and x['headers'].get('cache-control')=='public, max-age=31536000, immutable',json.dumps(x)
  decoded=gzip.decompress(body)if x['headers'].get('content-encoding')=='gzip'else body
  assert sha(decoded)==PLAN['scriptSha256'],'Static script bytes changed'
  if enc=='gzip':assert x['headers'].get('content-encoding')=='gzip' and len(body)<script.stat().st_size*.6
  for k in ['x-content-type-options','strict-transport-security','referrer-policy']:assert k in x['headers'],'Missing security header: '+k
 font=PLAN['scriptPath'].rsplit('/',1)[0]+'/assets/fonts/jigsaw-ui-sc.woff2';x,body=probe(font,'gzip');checks.append(x);assert x['status']==200 and 'immutable'in x['headers'].get('cache-control','') and 'content-encoding'not in x['headers']
 for path in ['/play','/api/health','/api/shared/config']:
  x,body=probe(path,'gzip');checks.append(x);assert x['status']==200 and 'no-store'in x['headers'].get('cache-control','') and 'immutable'not in x['headers'].get('cache-control','')
 x,body=probe('/shared-client/0000000000000000/game.js');checks.append(x);assert x['status']==404 and 'immutable'not in x['headers'].get('cache-control','')
 after={'web':app_health(3103,'/api/health'),'mobile':app_health(3292,'/healthz')}
 assert all(before[k].get('contentReleaseId')==after[k].get('contentReleaseId')for k in before),'Content release changed'
 assert os.path.realpath('/srv/sites/jigsaw/current')==PLAN['expectedCurrent'] and sha(script.read_bytes())==PLAN['scriptSha256']
 result={'applied':True,'backup':str(backup),'sitePath':str(p),'beforeSha256':sha(old),'afterSha256':sha(new),'nginxTest':syntax,'applicationReleaseUnchanged':True,'contentReleaseUnchanged':True,'checks':checks,'healthBefore':before,'healthAfter':after}
 (backup/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
except BaseException as e:
 if changed:replace(old);command(['nginx','-t']);command(['systemctl','reload','nginx'])
 print(json.dumps({'applied':False,'rolledBack':changed,'backup':str(backup),'error':str(e),'checks':locals().get('checks',[])},ensure_ascii=False));raise
