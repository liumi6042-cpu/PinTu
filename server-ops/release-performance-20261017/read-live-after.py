import pathlib,json,hashlib,subprocess,sqlite3,time,urllib.request,shutil,re
def sha(path):
    return hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
def command(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def dbcheck(path):
    with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=10) as db:
        check=db.execute('PRAGMA quick_check').fetchone()[0]
        assert check=='ok',str(path)
        tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        result={'path':str(path),'bytes':path.stat().st_size,'inode':path.stat().st_ino,'journalMode':db.execute('PRAGMA journal_mode').fetchone()[0],'quickCheck':check,'tableCount':len(tables)}
        result['rows']={name:db.execute('SELECT count(*) FROM "'+name+'"').fetchone()[0] for name in tables if re.fullmatch(r'mobile_(?:profiles|rooms|settlements|collection_wallets|social_players)|h5_sessions',name)}
        return result
def get(url,headers={}):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=15) as response:
        assert response.status==200
        return json.load(response)
base=pathlib.Path('/srv/sites/jigsaw')
mobile_base=pathlib.Path('/srv/sites/jigsaw-mobile-v3')
web=(base/'current').resolve(strict=True)
mobile=(mobile_base/'current').resolve(strict=True)
assert web==base/'releases/20261017-01/app'
assert mobile==mobile_base/'releases/20261017-perf42'
out={'readOnly':True,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'current':{'web':str(web),'mobile':str(mobile)},'services':{}}
for unit,expected in [('jigsaw-web@3104.service','active'),('jigsaw-web@3103.service','inactive'),('jigsaw-mobile-v3.service','active'),('jigsaw-h5.service','active')]:
    value=subprocess.run(['systemctl','is-active',unit],capture_output=True,text=True).stdout.strip()
    assert value==expected,(unit,value)
    out['services'][unit]=value
assert (base/'releases/20261016-04/app/release.json').is_file()
assert (mobile_base/'releases/20261016-blossom41/release.json').is_file()
out['rollbackReleasesPreserved']=True
webmanifest=web/'release.json'
mobilemanifest=mobile/'release.json'
assert sha(webmanifest)=='ad756085142081a774874d933da81af7b96800a41c73a0e2d6b016c98c6c9b6c'
assert sha(mobilemanifest)=='fde07727e4bb1939822223c2d8025ed73bb12f2c9d28e9763706ad6f559387bb'
out['releaseManifests']={'web':sha(webmanifest),'mobile':sha(mobilemanifest)}
pointer=pathlib.Path('/srv/sites/jigsaw-content/current.json')
assert sha(pointer)=='6bd1ab08a91757bb106cba1d3c39050ea2ede57204081eb36edb8d0b7c3f3f59'
published=json.loads(pointer.read_text())
out['contentPointer']={'pointer':published,'sha256':sha(pointer),'unchanged':True}
out['health']={'web':get('http://127.0.0.1:3104/api/health',{'Host':'jigsawnook.online','X-Forwarded-Proto':'https'}),'mobile':get('http://127.0.0.1:3292/healthz')}
assert all(health['contentReleaseId']==published['releaseId'] for health in out['health'].values())
out['contentChecks']={}
for label,root in [('web',web),('mobile',mobile)]:
    result=json.loads(command('runuser','-u','web-jigsaw','--','env',
        'JIGSAW_CONTENT_RELEASE_DIR=/srv/sites/jigsaw-content/releases/'+published['releaseId'],
        'JIGSAW_CONTENT_RELEASE_ID='+published['releaseId'],
        'JIGSAW_CONTENT_MANIFEST_SHA256='+published['manifestSha256'],
        '/usr/local/bin/node',str(root/'scripts/check-content-release.mjs')))
    assert result['ok'] is True and result['contentReleaseId']==published['releaseId']
    out['contentChecks'][label]=result
nginx=pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').read_bytes()
assert b'http://127.0.0.1:3104' in nginx and b'http://127.0.0.1:3103' not in nginx
previous=nginx.replace(b'http://127.0.0.1:3104',b'http://127.0.0.1:3103')
assert hashlib.sha256(previous).hexdigest()=='8dd3200d1bbaee8c898e25ec0dc0427e3f3739f16205d399bd6b9dc38dcbd4ca'
out['nginx']={'sha256':hashlib.sha256(nginx).hexdigest(),'onlyUpstreamPortChanged':True,'previousCachingPreserved':True}
out['databases']=[dbcheck(pathlib.Path(name)) for name in ['/srv/sites/jigsaw/shared/puzzle.sqlite','/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite','/srv/sites/jigsaw-mobile-v3/shared/sessions.sqlite']]
backup_folder=base/'shared/backups'
web_backups=sorted(backup_folder.glob('jigsaw-*.sqlite'))
latest=web_backups[-1]
receipt=json.loads(pathlib.Path(str(latest)+'.json').read_text())
assert latest.name==receipt['file'] and receipt['integrity']=='ok' and sha(latest)==receipt['sha256']
assert receipt['createdAt']>='2026-10-16T18:00:00'
out['backups']={'web':{**receipt,'path':str(latest),'verifiedSha256':True,'quickCheck':dbcheck(latest)['quickCheck']}}
mobile_backup=json.loads((mobile/'deployment/backup.json').read_text())
for record in mobile_backup['databases']:
    path=mobile_base/'shared'/record['path']
    assert path.is_file() and sha(path)==record['sha256'] and path.stat().st_size==record['bytes']
    assert dbcheck(path)['quickCheck']=='ok'
out['backups']['mobile']=mobile_backup
out['recentDatabaseErrors']={}
for unit in ['jigsaw-web@3104.service','jigsaw-mobile-v3.service']:
    logs=command('journalctl','-u',unit,'--since','30 minutes ago','--no-pager','-q','-o','cat','-n','1000')
    found=len(re.findall(r'SQLITE_BUSY|SQLITE_LOCKED|database is locked|SQLITE_FULL|database or disk is full',logs,re.I))
    out['recentDatabaseErrors'][unit]={'maxLogLines':1000,'matched':found}
    assert found==0
out['disk']=dict(zip(['total','used','free'],shutil.disk_usage('/srv/sites')))
out['passed']=True
print(json.dumps(out,ensure_ascii=False))
