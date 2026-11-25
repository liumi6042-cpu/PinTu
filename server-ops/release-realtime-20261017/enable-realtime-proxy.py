"""Add two exact WS routes to the current HTTPS vhost; preserve existing rules."""
import argparse,hashlib,json,os,pathlib,stat,subprocess,tempfile,time
p=argparse.ArgumentParser();p.add_argument('--expect-sha256',required=True);p.add_argument('--check-only',action='store_true');args=p.parse_args()
def sha(data): return hashlib.sha256(data).hexdigest()
def run(*command): return subprocess.run(command,check=True,capture_output=True,text=True).stdout.strip()
nginx=pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').resolve(strict=True)
assert nginx.name=='jigsawnook.online.conf' and pathlib.Path('/etc/nginx') in nginx.parents
assert pathlib.Path('/srv/sites/jigsaw/current').resolve()==pathlib.Path('/srv/sites/jigsaw/releases/20261017-01/app')
assert pathlib.Path('/srv/sites/jigsaw-mobile-v3/current').resolve()==pathlib.Path('/srv/sites/jigsaw-mobile-v3/releases/20261017-perf42')
before=nginx.read_bytes();assert sha(before)==args.expect_sha256,'Nginx changed; inspect again'
assert b'location = /api/shared/realtime' not in before and b'location = /h5-mobile-v3/realtime' not in before
anchor=b'    # Isolated mobile game API; PC and legacy H5 routes remain unchanged.'
assert before.count(anchor)==1
blocks=b'''    # BEGIN jigsaw realtime v1 - exact game WebSocket endpoints
    location = /api/shared/realtime {
        proxy_http_version 1.1;
        proxy_set_header Host jigsawnook.online;
        proxy_set_header X-Forwarded-Host jigsawnook.online;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header CF-Connecting-IP $remote_addr;
        proxy_set_header X-Puzzle-Country $jigsaw_ip_country;
        proxy_set_header CF-IPCountry "";
        proxy_set_header Forwarded "";
        proxy_set_header oai-authenticated-user-id "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
        proxy_pass http://127.0.0.1:3104;
        add_header Cache-Control "private, no-store" always;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy no-referrer always;
        add_header Strict-Transport-Security "max-age=31536000" always;
    }
    location = /h5-mobile-v3/realtime {
        proxy_pass http://127.0.0.1:3292/h5/realtime;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Jigsaw-Client-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
        add_header Cache-Control "private, no-store" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }
    # END jigsaw realtime v1

'''
after=before.replace(anchor,blocks+anchor);assert after.replace(blocks,b'',1)==before
result={'checkOnly':args.check_only,'beforeSha256':sha(before),'afterSha256':sha(after),'exactRoutes':2,'allExistingBytesPreserved':True}
if args.check_only: print(json.dumps(result));raise SystemExit
info=nginx.stat();assert stat.S_ISREG(info.st_mode)
backup=pathlib.Path('/srv/sites/jigsaw/shared/backups')/('realtime-nginx-'+str(int(time.time())))
backup.mkdir();(backup/'before.conf').write_bytes(before);(backup/'after.conf').write_bytes(after)
def write(expected,data):
 assert nginx.read_bytes()==expected,'Nginx changed during coordinated write'
 fd,temp=tempfile.mkstemp(prefix='.jigsaw-realtime-',dir=nginx.parent)
 try:
  with os.fdopen(fd,'wb') as f:
   os.fchown(f.fileno(),info.st_uid,info.st_gid);os.fchmod(f.fileno(),stat.S_IMODE(info.st_mode));f.write(data);f.flush();os.fsync(f.fileno())
  assert nginx.read_bytes()==expected
  os.replace(temp,nginx)
 finally:
  if os.path.exists(temp):os.unlink(temp)
write(before,after)
try:
 run('nginx','-t');run('systemctl','reload','nginx')
except Exception:
 write(after,before);run('nginx','-t');run('systemctl','reload','nginx');raise
result.update({'applied':True,'backup':str(backup),'syntaxVerified':True,'nginxReloaded':True})
(backup/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
