"""Initial isolated mobile API deployment; never updates the PC or legacy H5 app.

Run on the known production host as root after uploading a verified API-only
archive. Existing mobile installations require an explicit separate upgrade.
"""
import argparse, hashlib, json, os, pathlib, pwd, re, socket, subprocess, tarfile, time, urllib.request

p=argparse.ArgumentParser()
p.add_argument('--release',required=True)
p.add_argument('--sha256',required=True)
p.add_argument('--resume',action='store_true',help='Resume this exact newly installed, stopped release after automatic rollback')
args=p.parse_args()
assert re.fullmatch(r'\d{8}-[a-z0-9-]{2,32}',args.release)
assert re.fullmatch(r'[a-f0-9]{64}',args.sha256)
base=pathlib.Path('/srv/sites/jigsaw-mobile-v3')
release=base/'releases'/args.release
archive=pathlib.Path('/tmp')/('jigsaw-mobile-backend-'+args.sha256[:16]+'.tar.gz')
unit=pathlib.Path('/etc/systemd/system/jigsaw-mobile-v3.service')
environment=pathlib.Path('/etc/webapps/jigsaw-mobile-v3.env')
nginx=pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').resolve()
assert os.geteuid()==0
assert nginx.name=='jigsawnook.online.conf' and pathlib.Path('/etc/nginx') in nginx.parents
if args.resume:
    assert base.exists() and unit.exists() and environment.exists()
    assert (base/'current').is_symlink() and (base/'current').resolve()==release
    assert subprocess.run(['systemctl','is-active','jigsaw-mobile-v3.service'],capture_output=True,text=True).stdout.strip()=='inactive'
else:
    assert not base.exists() and not unit.exists() and not environment.exists(), 'Use an explicit upgrade procedure for an existing mobile service'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==args.sha256
with socket.socket() as sock: sock.bind(('127.0.0.1',3292))
account=pwd.getpwnam('web-jigsaw')
def run(*command):
    return subprocess.run(command,check=True,capture_output=True,text=True).stdout.strip()
for old_unit in ['jigsaw-web@3104.service','jigsaw-h5.service']:
    assert run('systemctl','is-active',old_unit)=='active'
assert run('/usr/local/bin/node','--version').startswith('v24.')
previous_links={path:str(pathlib.Path(path).resolve()) for path in ['/srv/sites/jigsaw/current','/srv/sites/jigsaw-h5/current']}
previous_units={path:hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest() for path in ['/etc/systemd/system/jigsaw-web@.service','/etc/systemd/system/jigsaw-h5.service']}
nginx_before=nginx.read_text()
if args.resume: assert (release/'deployment/nginx.before.conf').read_text()==nginx_before
assert '/h5-mobile-v3/' not in nginx_before
anchor=re.search(r'^([ \t]*)location = /healthz \{ proxy_pass http://127\.0\.0\.1:3104/api/health; \}$',nginx_before,re.M)
assert anchor and len(re.findall(r'location = /healthz',nginx_before))==1
block='''    # Isolated mobile game API; PC and legacy H5 routes remain unchanged.
    location ^~ /h5-mobile-v3/ {
        client_max_body_size 3m;
        proxy_pass http://127.0.0.1:3292/h5/;
        proxy_set_header X-Jigsaw-Client-IP $remote_addr;
        proxy_read_timeout 70s;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }

'''
nginx_after=nginx_before[:anchor.start()]+block+nginx_before[anchor.start():]
assert nginx_after.replace(block,'',1)==nginx_before
if not args.resume:
    release.mkdir(parents=True)
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            target=(release/member.name).resolve()
            assert release in target.parents
            assert member.isfile() or member.isdir()
            assert not re.search(r'(?:^|/)(?:data|backups|\.git|\.env[^/]*)(?:/|$)|\.(?:sqlite(?:-\w+)?|db|pem|key|p12)$',member.name)
        bundle.extractall(release,filter='data')
manifest=json.loads((release/'release.json').read_text())
assert manifest['service']=='jigsaw-mobile-v3' and manifest['release']==args.release
assert manifest['frontendIncluded'] is False
for file in manifest['files']:
    path=(release/file['path']).resolve()
    assert release in path.parents and path.is_file() and path.stat().st_size==file['bytes']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==file['sha256']
record=release/'deployment';record.mkdir(mode=0o700,exist_ok=args.resume)
(record/'nginx.before.conf').write_text(nginx_before)
(record/'nginx.before.conf').chmod(0o600)
for path in release.rglob('*'):
    if path==record or record in path.parents: continue
    if path.is_dir(): path.chmod(0o755)
    else: path.chmod(0o644)
release.chmod(0o755)
shared=base/'shared';shared.mkdir(mode=0o700,exist_ok=args.resume);os.chown(shared,account.pw_uid,account.pw_gid)
if not args.resume: (base/'current').symlink_to(release)
environment.write_text('''# Generated for the isolated mobile API. No PC/TapTap credentials are copied.
H5_HOST=127.0.0.1
H5_PORT=3292
H5_ALLOWED_ORIGINS=https://jigsawnook.online,https://servicewechat.com,https://ma-h5-al.tapimg.com
H5_PUBLIC_API_BASE=/h5-mobile-v3
H5_PUBLIC_GAME_BASE=/taptap-mobile-v3/
H5_SESSION_DB=/srv/sites/jigsaw-mobile-v3/shared/sessions.sqlite
MOBILE_DB=/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite
MOBILE_ASSET_DIR=/srv/sites/jigsaw-mobile-v3/current/public
H5_TRUST_LOOPBACK_PROXY=true
H5_AD_ASSISTANCE_ENABLED=false
H5_REWARDED_AD_UNIT=
''')
environment.chmod(0o600)
unit.write_text('''[Unit]
Description=Jigsaw Nook isolated shared mobile API
After=network.target
[Service]
Type=simple
User=web-jigsaw
Group=web-jigsaw
WorkingDirectory=/srv/sites/jigsaw-mobile-v3/current
Environment=NODE_ENV=production
EnvironmentFile=/etc/webapps/jigsaw-mobile-v3.env
ExecStart=/usr/local/bin/node server/h5-gateway.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/sites/jigsaw-mobile-v3/shared
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
MemoryMax=512M
TasksMax=64
[Install]
WantedBy=multi-user.target
''')
unit.chmod(0o644)
def get(url):
    request=urllib.request.Request(url,headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request,timeout=20) as response:
        return response.status, response.headers, response.read()
def json_get(url):
    status,_,body=get(url)
    assert status==200
    return json.loads(body)
changed_nginx=False
try:
    run('systemctl','daemon-reload')
    run('systemctl','enable','--now','jigsaw-mobile-v3.service')
    for attempt in range(40):
        try:
            health=json_get('http://127.0.0.1:3292/healthz')
            assert health['mode']=='mobile-v3-isolated'
            break
        except Exception:
            if attempt==39: raise
            time.sleep(.25)
    config=json_get('http://127.0.0.1:3292/h5/config')
    assert config['mobileMode']=='mobile-v3-isolated' and config['adRewardEnabled'] is False and not config['rewardedAdUnitId']
    sample=next(file for file in manifest['files'] if re.search(r'^public/puzzles/.*-thumbnail-[a-f0-9]{12}\.webp$',file['path']))
    status,_,image=get('http://127.0.0.1:3292/h5/assets/'+sample['path'][7:])
    assert status==200 and hashlib.sha256(image).hexdigest()==sample['sha256']
    # Preserve every existing byte outside the added location, including other
    # server blocks and all original PC/H5 locations.
    assert nginx.read_text()==nginx_before
    temporary=nginx.with_name(nginx.name+'.mobile-new')
    temporary.write_text(nginx_after)
    temporary.chmod(nginx.stat().st_mode)
    temporary.replace(nginx);changed_nginx=True
    run('nginx','-t')
    run('systemctl','reload','nginx')
    # Verify the real HTTPS virtual host directly. Cloudflare rejects the
    # origin server's automated egress with 1010 even for the old working H5;
    # external public checks run separately from the operator's client.
    # systemctl reload acknowledges nginx before old workers have drained.
    for attempt in range(20):
        try:
            routed_config=run('curl','--fail','--silent','--show-error','--resolve','jigsawnook.online:443:127.0.0.1','https://jigsawnook.online/h5-mobile-v3/config')
            public_config=json.loads(routed_config)
            assert public_config['mobileMode']=='mobile-v3-isolated'
            break
        except Exception:
            if attempt==19: raise
            time.sleep(.25)
    routed_image=subprocess.run(['curl','--fail','--silent','--show-error','--resolve','jigsawnook.online:443:127.0.0.1','https://jigsawnook.online/h5-mobile-v3/assets/'+sample['path'][7:]],check=True,capture_output=True).stdout
    assert hashlib.sha256(routed_image).hexdigest()==sample['sha256']
    for path,target in previous_links.items(): assert str(pathlib.Path(path).resolve())==target
    for path,digest in previous_units.items(): assert hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()==digest
    for old_unit in ['jigsaw-web@3104.service','jigsaw-h5.service']: assert run('systemctl','is-active',old_unit)=='active'
    assert nginx.read_text().replace(block,'',1)==nginx_before
    report={'release':args.release,'archiveSha256':args.sha256,'service':'jigsaw-mobile-v3.service','active':run('systemctl','is-active','jigsaw-mobile-v3.service'),'publicApi':'https://jigsawnook.online/h5-mobile-v3','publicConfig':public_config,'httpsVirtualHostVerified':True,'externalPublicCheck':'pending operator-client check','assetSample':sample['path'][7:],'assetSha256':sample['sha256'],'assetCount':manifest['assetCount'],'frontendDeployed':False,'oldAppLinksUnchanged':previous_links,'oldUnitHashesUnchanged':True,'nginxChange':'one added /h5-mobile-v3/ location','playerDataImported':False,'smokeCreatedPlayers':False,'verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    (record/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))
except Exception:
    if changed_nginx:
        nginx.write_text(nginx_before)
        run('nginx','-t')
        run('systemctl','reload','nginx')
    subprocess.run(['systemctl','disable','--now','jigsaw-mobile-v3.service'],capture_output=True)
    raise
