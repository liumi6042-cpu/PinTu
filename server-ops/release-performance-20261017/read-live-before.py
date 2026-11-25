import pathlib,os,json,base64,hashlib,subprocess,sqlite3,re,time,shutil
out={'checkedAtEpoch':int(time.time()),'readOnly':True,'files':{},'services':{},'databases':[],'resources':{}}
web=pathlib.Path('/srv/sites/jigsaw/current').resolve();mobile=pathlib.Path('/srv/sites/jigsaw-mobile-v3/current').resolve();out['current']={'web':str(web),'mobile':str(mobile)}
for label,root in [('web',web),('mobile',mobile)]:
 manifest=root/'release.json';data=manifest.read_bytes();out['files'][label+'/release.json']={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()}
 m=json.loads(data)
 paths=[x['path']for x in m['files']if not x['path'].startswith('public/')]if label=='mobile'else ['server/content-release.mjs','server/managed-content.node.mjs','server/runtime.node.mjs','server/sqlite.mjs']
 for name in paths:
  p=root/name
  assert p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root)
  data=p.read_bytes();assert len(data)<8*1024*1024
  out['files'][label+'/'+name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()}
units=['jigsaw-web@3103.service','jigsaw-web@3104.service','jigsaw-mobile-v3.service']
pathkeys={'DATABASE_PATH','MOBILE_DB','H5_SESSION_DB','JIGSAW_CONTENT_DIR','JIGSAW_DAILY_APPEARANCES_DIR','MOBILE_DAILY_APPEARANCES'};dbpaths=set()
for unit in units:
 x=subprocess.run(['systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','EnvironmentFiles','-p','WorkingDirectory'],capture_output=True,text=True)
 details=dict(s.split('=',1)for s in x.stdout.splitlines()if'='in s);envfiles=re.findall(r'(/[\w./@-]+)\s+\(ignore_errors=',details.get('EnvironmentFiles',''));paths={}
 for name in envfiles:
  p=pathlib.Path(name)
  if not p.is_file():continue
  for line in p.read_text().splitlines():
   key,sep,value=line.partition('=')
   if sep and key.strip()in pathkeys:
    value=value.strip().strip('\"').strip("'")
    if value.startswith('/'):
     paths[key.strip()]=value
     if key.strip()in {'DATABASE_PATH','MOBILE_DB','H5_SESSION_DB'}:dbpaths.add(value)
 details['pathSettings']=paths
 pid=details.get('MainPID','0')
 if pid!='0':
  try:details['processMemory']={k:v.strip()for k,v in(s.split(':',1)for s in pathlib.Path('/proc/'+pid+'/status').read_text().splitlines()if':'in s)if k in ['VmRSS','VmHWM','Threads']}
  except OSError:pass
 out['services'][unit]=details
 logs=subprocess.run(['journalctl','-u',unit,'--since','24 hours ago','--no-pager','-q','-o','cat','-n','5000'],capture_output=True,text=True).stdout
 details['recentLogs']={'maxLines':5000,'returnedLines':len(logs.splitlines()),'sqliteBusyMessages':len(re.findall(r'SQLITE_BUSY|database is locked|SQLITE_LOCKED',logs,re.I)),'sqliteFullMessages':len(re.findall(r'SQLITE_FULL|database or disk is full',logs,re.I))}
for value in sorted(dbpaths):
 p=pathlib.Path(value)
 if not p.is_file():continue
 db=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True,timeout=5);r={'path':str(p),'bytes':p.stat().st_size,'walBytes':pathlib.Path(str(p)+'-wal').stat().st_size if pathlib.Path(str(p)+'-wal').exists()else 0,'journalMode':db.execute('PRAGMA journal_mode').fetchone()[0]}
 tables=[x[0]for x in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")];r['tableCount']=len(tables);r['rows']={}
 for name in tables:
  if re.fullmatch(r'(?:accounts|users|rooms|room_members|room_groups|room_pieces|guests|guest_identities|h5_sessions|mobile_profiles|mobile_rooms|mobile_settlements|mobile_replays|mobile_social_players|mobile_collection_wallets|mobile_collection_purchases|mobile_coin_ledger)',name):r['rows'][name]=db.execute('SELECT count(*) FROM "'+name+'"').fetchone()[0]
 r['pageCount']=db.execute('PRAGMA page_count').fetchone()[0];r['pageSize']=db.execute('PRAGMA page_size').fetchone()[0];db.close();out['databases'].append(r)
out['resources']={'cpuCount':os.cpu_count(),'loadAverage':os.getloadavg(),'memoryKiB':{k:v.strip()for k,v in(s.split(':',1)for s in pathlib.Path('/proc/meminfo').read_text().splitlines())if k in ['MemTotal','MemAvailable']},'disk':dict(zip(['total','used','free'],shutil.disk_usage('/srv/sites')))}
print(json.dumps(out,ensure_ascii=False))
