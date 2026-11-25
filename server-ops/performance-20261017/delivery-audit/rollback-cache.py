BACKUP='/srv/sites/jigsaw/shared/backups/delivery-cache-20261016T174556Z/nginx-before.conf'
CURRENT_SHA='8dd3200d1bbaee8c898e25ec0dc0427e3f3739f16205d399bd6b9dc38dcbd4ca'
ORIGINAL_SHA='fff5c845038e7d44527786aa3372a44bbb5ebb8b611a88742b0161a128969ef9'
import pathlib,hashlib,subprocess,tempfile,os,stat
site=pathlib.Path('/etc/nginx/sites-available/jigsawnook.online.conf')
backup=pathlib.Path(BACKUP)
current=site.read_bytes();old=backup.read_bytes();info=site.stat()
assert hashlib.sha256(current).hexdigest()==CURRENT_SHA,'Configuration has changed; review before rollback'
assert hashlib.sha256(old).hexdigest()==ORIGINAL_SHA,'Backup mismatch'
def replace(data):
 fd,name=tempfile.mkstemp(prefix='.jigsaw-cache-rollback-',dir=site.parent)
 try:
  with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),info.st_uid,info.st_gid);os.fchmod(f.fileno(),stat.S_IMODE(info.st_mode));f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(name,site)
 finally:
  if os.path.exists(name):os.unlink(name)
try:
 replace(old);subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
except BaseException:
 replace(current);subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True);raise
print('Restored the original Nginx site configuration; application and content releases untouched.')
