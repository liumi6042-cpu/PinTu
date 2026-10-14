"""Verified runtime-only, migration-free warm deployment on the existing host.

Run on the Linux host with explicit release/hash/commit/previous release and ports.
Never ships source or original artwork. All mutable acceptance tests use a temp DB.
"""
import argparse, hashlib, json, os, pathlib, re, secrets, socket, sqlite3, subprocess
import tarfile, tempfile, time, urllib.request, urllib.error

p = argparse.ArgumentParser()
p.add_argument('--additive-migration-sha256')
p.add_argument('--migration-sha256', action='append', default=[], metavar='NAME=SHA256')
for name in ['release', 'previous', 'sha256', 'commit', 'old-unit']:
    p.add_argument('--' + name, required=True)
p.add_argument('--from-port', type=int, required=True, choices=[3103, 3104])
p.add_argument('--to-port', type=int, required=True, choices=[3103, 3104])
args = p.parse_args()
assert args.from_port != args.to_port
assert all(re.fullmatch(r'\d{8}-\d{2}', x) for x in [args.release, args.previous])
assert re.fullmatch(r'[a-f0-9]{64}', args.sha256) and re.fullmatch(r'[a-f0-9]{40}', args.commit)
assert args.old_unit in ['jigsaw-web.service', f'jigsaw-web@{args.from_port}.service']
base = pathlib.Path('/srv/sites/jigsaw').resolve()
old = base / 'releases' / args.previous / 'app'
release = base / 'releases' / args.release
app = release / 'app'
archive = pathlib.Path('/tmp') / ('jigsaw-nook-' + args.sha256[:16] + '.tar.gz')
nginx = pathlib.Path('/etc/nginx/sites-enabled/jigsawnook.online.conf').resolve()
assert nginx.name == 'jigsawnook.online.conf' and pathlib.Path('/etc/nginx') in nginx.parents
assert (base / 'current').resolve() == old and not release.exists()
assert hashlib.sha256(archive.read_bytes()).hexdigest() == args.sha256
def run(*command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()
def free(port):
    with socket.socket() as s:
        s.bind(('127.0.0.1', port))
for port in [3138, 3139, args.to_port]: free(port)
assert run('systemctl', 'is-active', args.old_unit) == 'active'
nginx_before = nginx.read_text()
source_address, target_address = [f'http://127.0.0.1:{port}' for port in [args.from_port, args.to_port]]
assert source_address in nginx_before and target_address not in nginx_before
nginx_after = nginx_before.replace(source_address, target_address).replace('(?:play|thumbnail)', '(?:play|standard|thumbnail|optimized|compact)').replace('(?:play|standard|thumbnail)', '(?:play|standard|thumbnail|optimized|compact)')

app.mkdir(parents=True)
with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        target = (app / member.name).resolve()
        assert target == app or app in target.parents
        assert member.isfile() or member.isdir()
    bundle.extractall(app, filter='data')
manifest = json.loads((app / 'release.json').read_text())
assert manifest['gitCommit'] == args.commit and not manifest['dirty'] and manifest['app'] == 'jigsaw-nook'
for item in manifest['files']:
    file = (app / item['path']).resolve()
    assert app in file.parents and file.stat().st_size == item['bytes']
    assert hashlib.sha256(file.read_bytes()).hexdigest() == item['sha256']
assert not (app / 'public').exists()
def migrations(root):
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in (root / 'drizzle').glob('*.sql')}
old_migrations, new_migrations = migrations(old), migrations(app)
added = set(new_migrations) - set(old_migrations)
assert all(new_migrations.get(name) == digest for name,digest in old_migrations.items()), 'Existing migrations must never change'
reviewed_migrations = {}
for item in args.migration_sha256:
    name, separator, digest = item.partition('=')
    assert separator and re.fullmatch(r'001[4-7]_[a-z_]+\.sql', name) and re.fullmatch(r'[a-f0-9]{64}', digest)
    assert name not in reviewed_migrations, 'Duplicate migration digest'
    reviewed_migrations[name] = digest
if args.additive_migration_sha256:
    assert not reviewed_migrations, 'Use either the legacy digest or explicit migration digests'
    reviewed_migrations = {'0014_piece_progress.sql': args.additive_migration_sha256}
if added:
    supported = {'0014_piece_progress.sql', '0015_managed_content_economy.sql',
                 '0016_managed_reward_outbox.sql', '0017_daily_piece_progress.sql'}
    assert added <= supported, 'Only reviewed additive migrations are allowed'
    assert set(reviewed_migrations) == added, 'Require one exact reviewed digest per new migration'
    for name in added:
        assert reviewed_migrations[name] == new_migrations[name], 'Migration digest mismatch: ' + name
        sql = (app / 'drizzle' / name).read_text().upper()
        assert 'DROP TABLE' not in sql and 'ALTER TABLE' not in sql and 'DELETE FROM' not in sql
        assert re.search(r'^CREATE TABLE IF NOT EXISTS ', sql, re.MULTILINE)
else:
    assert not reviewed_migrations


headers = {'Host': 'jigsawnook.online', 'X-Forwarded-Host': 'jigsawnook.online', 'X-Forwarded-Proto': 'https', 'CF-Connecting-IP': '192.0.2.43'}
def request(port, path, body=None, actor=None):
    h = dict(headers)
    if body is not None: h['Content-Type'] = 'application/json'
    if actor:
        if actor.get('cookie'): h['Cookie'] = actor['cookie']
        if actor.get('token'): h['Authorization'] = 'Bearer ' + actor['token']
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=None if body is None else json.dumps(body).encode(), headers=h)
    try: response = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as error: response = error
    with response:
        return response.status, response.headers, response.read()
def get(port, path):
    status, head, data = request(port, path)
    assert status == 200, (path, status)
    return head, data
def ready(port):
    for _ in range(60):
        try:
            get(port, '/api/health')
            return
        except Exception: time.sleep(.25)
    raise RuntimeError('Health check failed')
def check(port, all_assets=False):
    for path in ['/', '/lobby', '/gallery', '/help']:
        html = get(port, path)[1].decode()
        assert 'href="/membership"' not in html
        if path == '/gallery':
            assert html.count('class="gallery-entry-card"') == min(12, manifest['publicPictures'])
            assert html.count('type="radio"') == 4
            for marker in ['mountain-lake-reflection-hd-v3', 'morning-meadow-tree-hd-v3', 'clear-sand-bay-hd-v3']:
                assert marker in get(port, '/puzzle/' + marker)[1].decode()
            for marker in ['class="picture-guidance"', 'class="picture-advice"', 'gallery-picture-details']:
                assert marker not in html
        head = html.partition('</head>')[0]
        assert 'name="msvalidate.01"' in head and 'name="google-site-verification"' in head
    if all_assets:
        inventory = {i['path']: i['sha256'] for i in manifest['files']}
        for url in manifest['runtimeAssets']:
            assert hashlib.sha256(get(port, url)[1]).hexdigest() == inventory['dist/client' + url]

# Both versions run against the same disposable DB. No production player IDs,
# cookies, room writes or test chat messages are used by acceptance tests.
with tempfile.TemporaryDirectory(prefix='jigsaw-release-test-') as temporary:
    processes, logs = [], []
    def launch(root, port):
        env = {'PATH': os.environ['PATH'], 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(port),
               'VINEXT_TRUSTED_HOSTS': 'jigsawnook.online', 'VINEXT_TRUST_PROXY': '1',
               'PUZZLE_PUBLIC_ORIGIN': 'https://jigsawnook.online', 'DATABASE_PATH': temporary + '/data/puzzle.sqlite', 'MIGRATIONS_DIR': str(root / 'drizzle')}
        log = open(temporary + '/' + str(port) + '.log', 'w'); logs.append(log)
        processes.append(subprocess.Popen(['/usr/local/bin/node', 'server.js'], cwd=root, env=env, stdout=log, stderr=log))
        ready(port)
    def json_request(port, path, body=None, actor=None, expected=200):
        status, head, raw = request(port, path, body, actor)
        assert status == expected, (path, status, expected, raw[:200])
        value = json.loads(raw)
        if actor is not None and head.get('Set-Cookie'): actor['cookie'] = head['Set-Cookie'].split(';')[0]
        return value
    try:
        launch(old, 3139)
        qa_db = pathlib.Path(temporary) / 'data/puzzle.sqlite'
        original_table_names = None
        def original_fingerprints():
            nonlocal_names = original_table_names
            with sqlite3.connect(qa_db) as connection:
                names=[row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='app_migrations'") if not row[0].startswith(('puzzle_courtyard','puzzle_lobby_chat','puzzle_welcome_gifts','puzzle_piece_progress'))]
                return {name:hashlib.sha256(repr(connection.execute('SELECT * FROM '+name+' ORDER BY rowid').fetchall()).encode()).hexdigest() for name in (nonlocal_names if nonlocal_names is not None else names)}
        fingerprints_before=original_fingerprints()
        original_table_names = tuple(fingerprints_before)
        launch(app, 3138)
        assert original_fingerprints()==fingerprints_before, 'Additive migration modified original data'
        # The old runtime remains healthy against the upgraded database.
        ready(3139)

        check(3138, True)
        json_request(3138, '/api/courtyard', expected=401)
        json_request(3138, '/api/lobby/chat', expected=410)
        garden_actor={}
        json_request(3138, '/api/auth/register', {'username':'garden_'+secrets.token_hex(5),'name':'QA garden','password':secrets.token_hex(16)}, garden_actor, 201)
        garden=json_request(3138, '/api/courtyard', actor=garden_actor)
        claim={'action':'checkin','requestId':secrets.token_hex(16),'version':garden['version']}
        claimed=json_request(3138, '/api/courtyard', claim, garden_actor)
        assert claimed['state']['balance']==1
        assert json_request(3138, '/api/courtyard', claim, garden_actor)['state']['balance']==1
        message={'text':'Isolated lobby QA','requestId':secrets.token_hex(16)}
        json_request(3138, '/api/lobby/chat', message, garden_actor, 410)
        assert not json_request(3138, '/api/lobby/chat', expected=410)['messages']
        ready(3139)
        old_picture = re.search(r'href="/puzzle/([a-z0-9-]+)"', get(3139, '/gallery')[1].decode()).group(1)
        for count in [3000, 5000]:
            actor = {}
            ticket = json_request(3139, '/api/rooms', {'visibility': 'public', 'imageId': old_picture, 'pieces': 108, 'guestSecret': secrets.token_hex(32)}, actor, 201)
            actor['token'] = ticket['token']; path = '/api/rooms/' + ticket['room']['id']
            # Seed a legacy save into the isolated DB: future versions correctly
            # reject retired counts at creation, but must continue existing games.
            with sqlite3.connect(temporary + '/data/puzzle.sqlite') as db:
                room = json.loads(db.execute('SELECT data FROM puzzle_rooms WHERE id=?', (ticket['room']['id'],)).fetchone()[0])
                room['puzzle'].update(imageId='mountain-lake-reflection-native-v2', cols=count//50, rows=50,
                    groups=[{'id': i, 'pieces': [i], 'dx': 200+(i%10)*5, 'dy': -100+(i//10)*5, 'locked': False} for i in range(count)])
                room['revision'] += 1
                db.execute('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?', (json.dumps(room), room['revision'], room['id']))
                db.execute('UPDATE puzzle_room_directory SET image_id=?,piece_count=? WHERE room_id=?', ('mountain-lake-reflection-native-v2', count, room['id']))
            json_request(3139, path, {'type': 'claim', 'groupId': 0}, actor)
            before = json_request(3139, path, {'type': 'move', 'groupId': 0, 'dx': 123, 'dy': 456, 'seq': 1}, actor)
            after = json_request(3138, path, None, actor)
            assert {k: v for k, v in after['puzzle'].items() if k != 'elapsed'} == {k: v for k, v in before['puzzle'].items() if k != 'elapsed'}
            assert 0 <= after['puzzle']['elapsed'] - before['puzzle']['elapsed'] <= 2 and after['revision'] == before['revision']
            json_request(3138, path, {'type': 'move', 'groupId': 0, 'dx': 125, 'dy': 460, 'seq': 2}, actor)
            seen = json_request(3139, path, None, actor)
            assert next(g for g in seen['puzzle']['groups'] if g['id'] == 0)['dx'] == 125
            text = 'Isolated cross-version test'
            json_request(3139, path + '/chat', {'requestId': secrets.token_hex(16), 'text': text}, actor)
            assert json_request(3138, path + '/chat', None, actor)['messages'][0]['text'] == text
            json_request(3138, path, {'type': 'release', 'groupId': 0}, actor)
            returning = json_request(3138, path + '/join', {}, actor)
            actor['token'] = returning['token']
            assert returning['room']['puzzle']['cols'] * returning['room']['puzzle']['rows'] == count
            # Sign-in covers creation only now: any guest may join any piece count.
            # The 500+ creation check for a fresh guest is covered below.
            guest = json_request(3138, path + '/join', {}, {})
            assert guest['room']['puzzle']['cols'] * guest['room']['puzzle']['rows'] == count
            head = get(3138, '/room/' + ticket['room']['id'])[1].decode().partition('</head>')[0]
            assert '/puzzles/mountain-lake-reflection-native-v2-optimized-' in head
        for count in [2000, 5000]:
            json_request(3138, '/api/rooms', {'visibility': 'public', 'imageId': 'seaside-native-v2', 'pieces': count, 'guestSecret': secrets.token_hex(32)}, {}, 400)
        for count in [1500, 2000, 3000, 4000, 5000]:
            json_request(3138, '/api/rooms', {'visibility': 'public', 'imageId': 'mountain-lake-reflection-hd-v3', 'pieces': count, 'guestSecret': secrets.token_hex(32)}, {}, 400)
        for count, kind in [(300, 'compact'), (1000, 'compact')]:
            actor = {}
            if count >= 500:
                json_request(3138, '/api/rooms', {'visibility': 'public', 'imageId': 'mountain-lake-reflection-hd-v3', 'pieces': count}, actor, 401)
                json_request(3138, '/api/auth/register', {'username': 'warm_' + secrets.token_hex(6), 'name': 'Warm test', 'password': secrets.token_hex(16)}, actor, 201)
            ticket = json_request(3138, '/api/rooms', {'visibility': 'public', 'imageId': 'mountain-lake-reflection-hd-v3', 'pieces': count, 'guestSecret': secrets.token_hex(32), 'initialState': 'seed-v1'}, actor, 201)
            assert 'groups' not in ticket['room']['puzzle'] and len(json.dumps(ticket)) < 1600
            actor['token'] = ticket['token']; path = '/api/rooms/' + ticket['room']['id']
            # Catalog rooms are fitted to the picture, so this 2:1 landscape plays
            # 24x12=288 at the 300 level and 38x26=988 at the 1000 level, not the
            # requested count. Assert the board the ticket promised was delivered.
            grid = ticket['room']['puzzle']
            assert len(json_request(3138, path, None, actor)['puzzle']['groups']) == grid['cols'] * grid['rows']
            head = get(3138, '/room/' + ticket['room']['id'])[1].decode().partition('</head>')[0]
            assert '/puzzles/mountain-lake-reflection-hd-v3-' + kind + '-' in head
        print('Isolated Linux: old rooms, cross-version moves/chat, resolution policy, SSR delivery and all assets passed.', flush=True)
    finally:
        for process in processes: process.terminate()
        for process in processes: process.wait(timeout=15)
        for log in logs: log.close()

# Hardlink only identical immutable pictures. Retain ALL old client hashes,
# including previous releases retained for clients that have not refreshed.
reused, retained, reused_bytes = 0, 0, 0
old_inventory = {i['path']: i for i in json.loads((old / 'release.json').read_text())['files']}
for item in manifest['files']:
    path = item['path']; previous = old_inventory.get(path)
    if not (path.startswith('dist/client/puzzles/') and path.endswith('.webp') and previous and previous['sha256'] == item['sha256']): continue
    source, target = old / path, app / path
    assert not source.is_symlink() and hashlib.sha256(source.read_bytes()).hexdigest() == item['sha256']
    sibling = target.with_name('.reuse-' + target.name)
    assert not sibling.exists(); os.link(source, sibling); os.replace(sibling, target)
    reused += 1; reused_bytes += item['bytes']
for source in (old / 'dist/client/_next/static').rglob('*'):
    if not source.is_file(): continue
    assert not source.is_symlink()
    target = app / 'dist/client/_next/static' / source.relative_to(old / 'dist/client/_next/static')
    if target.exists(): assert target.read_bytes() == source.read_bytes()
    else:
        target.parent.mkdir(parents=True, exist_ok=True); os.link(source, target); retained += 1

unit_path = pathlib.Path('/etc/systemd/system/jigsaw-web@.service')
# The replacement host already has the reviewed instance template and no legacy unit.
# Reuse it verbatim; only older hosts derive the template from their legacy unit.
template = unit_path.read_text() if unit_path.exists() else pathlib.Path('/etc/systemd/system/jigsaw-web.service').read_text()
template = template.replace('WorkingDirectory=/srv/sites/jigsaw/current', 'WorkingDirectory=/srv/sites/jigsaw/slots/%i').replace('Environment=PORT=3103', 'Environment=PORT=%i')
assert 'WorkingDirectory=/srv/sites/jigsaw/slots/%i' in template and 'Environment=PORT=%i' in template
assert '[Install]' in template and 'WantedBy=multi-user.target' in template
if unit_path.exists(): assert unit_path.read_text() == template
else: unit_path.write_text(template)
slots = base / 'slots'; slots.mkdir(exist_ok=True)
slot = slots / str(args.to_port)
new_unit = f'jigsaw-web@{args.to_port}.service'
assert subprocess.run(['systemctl', 'is-active', '--quiet', new_unit]).returncode != 0
if slot.is_symlink(): slot.unlink()
assert not slot.exists(); slot.symlink_to(app)
# Read access only for the dedicated service user; user and filesystem sandbox
# are inherited verbatim from the existing unit.
run('chown', '-R', 'web-jigsaw:web-jigsaw', str(release))
run('systemctl', 'daemon-reload')
run('systemctl', 'start', 'jigsaw-backup.service')
run('systemctl', 'start', new_unit)
ready(args.to_port); check(args.to_port)
assert (base / 'current').resolve() == old and nginx.read_text() == nginx_before
def worker_pids():
    return {int(line.strip().split(None, 1)[0]) for line in run('ps', '-eo', 'pid,args').splitlines() if 'nginx: worker process' in line}
workers = worker_pids()
staged = base / 'current-warm-next'
assert not staged.exists() and not staged.is_symlink()
def point_current(target):
    staged.symlink_to(target); os.replace(staged, base / 'current')
try:
    point_current(app)
    nginx.write_text(nginx_after)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
except Exception:
    nginx.write_text(nginx_before); point_current(old)
    run('nginx', '-t'); run('systemctl', 'reload', 'nginx')
    raise
run('systemctl', 'enable', new_unit)
drained = False
quiet_since = None
for _ in range(80):
    if not workers.intersection(worker_pids()):
        drained = True; break
    # Other sites can keep old global nginx workers alive with WebSockets.
    # This app uses bounded HTTP polling, not upgraded/streaming connections.
    # Require 10 continuous seconds with no TCP connection on its old port.
    connections = run('ss', '-Htn', f'( sport = :{args.from_port} or dport = :{args.from_port} )')
    active = [line for line in connections.splitlines() if not line.startswith('TIME-WAIT')]
    if active: quiet_since = None
    elif quiet_since is None: quiet_since = time.monotonic()
    elif time.monotonic() - quiet_since >= 10:
        drained = True; break
    time.sleep(.5)
if drained:
    run('systemctl', 'stop', args.old_unit)
    run('systemctl', 'disable', args.old_unit)
# Backup uses current and does not require starting the retired legacy service.
backup = pathlib.Path('/etc/systemd/system/jigsaw-backup.service')
backup_text = backup.read_text()
if 'After=jigsaw-web.service' in backup_text:
    backup.write_text(backup_text.replace('After=jigsaw-web.service', 'After=network.target'))
    run('systemctl', 'daemon-reload')
check(args.to_port)
report = {'release': args.release, 'gitCommit': args.commit, 'activeUnit': new_unit, 'port': args.to_port,
          'rollback': str(old), 'previousUnit': args.old_unit, 'oldAppRequestsDrained': drained,
          'assetsChecked': len(manifest['runtimeAssets']), 'retainedHashedAssets': retained,
          'reusedImmutableAssets': reused, 'reusedImmutableBytes': reused_bytes,
          'migrationChanges': bool(added), 'additiveMigrationSha256': args.additive_migration_sha256,
          'reviewedMigrationSha256': reviewed_migrations, 'isolatedCrossVersionTests': True, 'forcedClientRefresh': False}
(release / 'deployment.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report), flush=True)
