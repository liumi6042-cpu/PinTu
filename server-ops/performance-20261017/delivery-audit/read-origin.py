import json, pathlib, hashlib, urllib.request, ssl
site=pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').resolve();data=site.read_bytes()
r={'sitePath':str(site),'sha256':hashlib.sha256(data).hexdigest(),'content':data.decode(),'origin':[]}
paths=['/shared-client/c70abf569b573db3/game.js','/shared-client/c70abf569b573db3/assets/fonts/jigsaw-ui-sc.woff2','/api/health']
for path in paths:
 for enc in ['identity','gzip']:
  req=urllib.request.Request('http://127.0.0.1:3103'+path,headers={'Host':'jigsawnook.online','X-Forwarded-Proto':'https','Accept-Encoding':enc})
  with urllib.request.urlopen(req,timeout=15)as x:
   body=x.read();r['origin'].append({'path':path,'acceptEncoding':enc,'status':x.status,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'headers':{k:v for k,v in x.headers.items() if k.lower() in ['content-type','content-length','cache-control','content-encoding','etag','vary']}})
print(json.dumps(r,ensure_ascii=False,indent=2))
