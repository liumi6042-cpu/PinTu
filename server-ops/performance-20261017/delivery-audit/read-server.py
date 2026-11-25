import json,subprocess,os,re,hashlib,time,pathlib
r={'checkedAtEpoch':int(time.time()),'readOnly':True,'current':{},'nginx':{},'traffic':{}}
for p in ['/srv/sites/jigsaw/current','/srv/sites/jigsaw-mobile-v3/current']:
 r['current'][p]=os.path.realpath(p)
x=subprocess.run(['nginx','-T'],capture_output=True,text=True);r['nginx']['valid']=x.returncode==0
configs={};current=None
for line in x.stdout.splitlines():
 m=re.match(r'# configuration file (.*):$',line)
 if m:current=m.group(1);configs[current]=[]
 elif current:configs[current].append(line)
r['nginx']['compressionDirectives']=[{'file':p,'line':s.strip()} for p,lines in configs.items() for s in lines if re.match(r'\s*(?:gzip|brotli|zstd)[_\s]',s) and not s.lstrip().startswith('#')]
r['nginx']['siteFiles']=[]
for p,lines in configs.items():
 if any(re.match(r'\s*server_name\s+.*jigsawnook\.online',s)for s in lines):
  data='\n'.join(lines)+'\n';r['nginx']['siteFiles'].append({'path':p,'sha256':hashlib.sha256(data.encode()).hexdigest(),'content':data})
  r['traffic']['siteAccessLogDirectives']=[s.strip() for s in lines if re.match(r'\s*access_log\s',s)]
r['nginx']['moduleCompressionSupport']={name:name in subprocess.run(['nginx','-V'],capture_output=True,text=True).stderr for name in ['gzip','brotli']}
r['traffic']['hostUptimeSeconds']=float(pathlib.Path('/proc/uptime').read_text().split()[0]);r['traffic']['hostNetworkTotalsSinceBoot']={}
for nic in pathlib.Path('/sys/class/net').iterdir():
 if nic.name=='lo':continue
 try:r['traffic']['hostNetworkTotalsSinceBoot'][nic.name]={k:int((nic/'statistics'/k).read_text())for k in ['rx_bytes','tx_bytes']}
 except OSError:pass
r['traffic']['vnstatAvailable']=subprocess.run(['sh','-c','command -v vnstat >/dev/null 2>&1']).returncode==0
if r['traffic']['vnstatAvailable']:
 v=subprocess.run(['vnstat','--json'],capture_output=True,text=True);r['traffic']['vnstatStatus']=v.returncode
 if v.returncode==0:r['traffic']['vnstat']=json.loads(v.stdout)
r['services']=subprocess.run(['systemctl','list-units','--type=service','--no-legend','--plain'],capture_output=True,text=True).stdout.splitlines();r['services']=[s for s in r['services']if 'jigsaw' in s]
print(json.dumps(r,ensure_ascii=False,indent=2))
