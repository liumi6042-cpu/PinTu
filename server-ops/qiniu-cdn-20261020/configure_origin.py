"""One-time origin Host migration; retains the original readback for rollback."""
import json
from pathlib import Path
import certificate_ops as ops
path='/domain/'+ops.DOMAIN
d=ops.qiniu('GET',path)
assert d['name']==ops.DOMAIN and d['operatingState']=='success'
s=d['source']
assert s['sourceType']=='ip' and s['sourceIPs']==['162.251.94.92']
assert s['sourceHost']=='jigsawnook.online' and s['sourceURLScheme']=='https'
ops.atomic_json(Path('/opt/jigsaw-cdn-cert/domain-before-origin.json'), d)
print(ops.qiniu('PUT',path+'/source',dict(sourceType='ip',sourceIPs=s['sourceIPs'],sourceHost=ops.DOMAIN,sourceURLScheme='https',testURLPath='/cdn-health.txt')))
print('Source update submitted')
