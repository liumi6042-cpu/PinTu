"""Install a new, isolated API vhost. Never overwrite existing site files."""
import hashlib
import json
from pathlib import Path
import subprocess
import time

source = Path('/opt/jigsaw-cdn-cert/api.ymxc.top.conf')
target = Path('/etc/nginx/sites-available/api.ymxc.top.conf')
link = Path('/etc/nginx/sites-enabled/api.ymxc.top.conf')
assert source.is_file() and not target.exists() and not link.exists()
existing = {str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in Path('/etc/nginx/sites-enabled').glob('*') if path.is_file()}
record = Path('/opt/jigsaw-cdn-cert/nginx-baseline.json')
if record.exists():
    assert json.loads(record.read_text()) == existing, "Baseline changed"
else:
    record.write_text(json.dumps(existing, indent=2))

def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout

try:
    target.write_bytes(source.read_bytes())
    target.chmod(0o644)
    link.symlink_to(target)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    time.sleep(2)  # nginx reload is asynchronous; let new workers take over.
    for resource in ('cdn-health.txt', 'h5-mobile-v3/config'):
        status = run('curl', '-sS', '--noproxy', '*', '--resolve', 'api.ymxc.top:443:127.0.0.1',
                     '-o', '/dev/null', '-w', '%{http_code}',
                     'https://api.ymxc.top/' + resource)
        assert status == '200', (resource, status)
    for path, digest in existing.items():
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, 'Another existing site changed concurrently'
    print('New API-only vhost installed; TLS and API probes passed; existing vhost files preserved')
except Exception:
    if link.is_symlink() and link.resolve() == target:
        link.unlink()
    if target.is_file() and target.read_bytes() == source.read_bytes():
        target.unlink()
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    raise
