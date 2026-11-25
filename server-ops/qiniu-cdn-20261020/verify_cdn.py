"""Read-only CDN/TLS verification, plus removal of our temporary probe file."""
import hashlib,json,socket,ssl,urllib.request
from pathlib import Path
import certificate_ops as ops
context=ssl.create_default_context()
with socket.create_connection((ops.DOMAIN,443),timeout=20) as raw:
    with context.wrap_socket(raw,server_hostname=ops.DOMAIN) as tls:
        fingerprint=hashlib.sha256(tls.getpeercert(binary_form=True)).hexdigest()
_,_,local,expiry=ops.certificate()
assert fingerprint==local
checks={}
for resource,method in [('cdn-health.txt','HEAD'),('h5-mobile-v3/config','GET'),('h5-mobile-v3/config','OPTIONS')]:
    req=urllib.request.Request('https://'+ops.DOMAIN+'/'+resource,method=method,headers={'Origin':'https://ma-h5-al.tapimg.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization'})
    try:
        with urllib.request.urlopen(req,timeout=20) as res:
            checks[method+' /'+resource]={'status':res.status,'cache':res.headers.get('Cache-Control'),'cors':res.headers.get('Access-Control-Allow-Origin'),'methods':res.headers.get('Access-Control-Allow-Methods')}
    except urllib.error.HTTPError as err:
        checks[method+' /'+resource]={'status':err.code}
assert checks['GET /h5-mobile-v3/config']['status']==200
assert checks['OPTIONS /h5-mobile-v3/config']['status']==204
assert checks['GET /h5-mobile-v3/config']['cors']=='https://ma-h5-al.tapimg.com'
assert checks['GET /h5-mobile-v3/config']['cache']=='no-store'
result={'domain':ops.DOMAIN,'fingerprint':fingerprint,'expiry':expiry,'checks':checks}
Path('/opt/jigsaw-cdn-cert/verification.json').write_text(json.dumps(result,indent=2))
probe=Path('/var/www/acme/.well-known/acme-challenge/codex-probe-20261020')
if probe.is_file() and probe.read_text()=='cdn-certificate-webroot-probe':
    probe.unlink()
print(json.dumps(result))
