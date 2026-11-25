"""Verified runtime-only, migration-free warm deployment on the existing host.

Run on the Linux host with explicit release/hash/commit/previous release and ports.
Never ships source or original artwork. All mutable acceptance tests use a temp DB.
"""
import argparse, hashlib, json, os, pathlib, re, secrets, shlex, socket, sqlite3, stat, subprocess
import tarfile, tempfile, time, urllib.request, urllib.error, urllib.parse

PUBLIC_ENV_KEYS = ('PUZZLE_OPERATOR_NAME', 'PUZZLE_SUPPORT_EMAIL')

def pre_artwork_qa_fixture(serialized):
    """Represent the pre-snapshot save format using one isolated QA room only.

    Puzzle, identity, members, lease and revision retain the actual old-runtime
    values. Only the optional drawing snapshot is absent, as before snapshots
    existed. This is explicitly a historical fixture, not an old create claim.
    """
    room = json.loads(serialized)
    assert isinstance(room.get('puzzle'), dict) and isinstance(room.get('id'), str)
    assert not room.get('customImage'), 'Artwork fixtures must use catalog images'
    room.pop('artwork', None)
    return json.dumps(room)


def assert_preserved_artwork_snapshot(before, restored, expected_artwork):
    """Check actual cross-runtime responses without weakening progress checks."""
    assert restored['id'] == before['id'], 'The restored room identity changed'
    assert restored['artwork'] == expected_artwork, 'The room drawing changed'
    assert urllib.parse.urlsplit(restored['photo']['src']).path == expected_artwork['src']
    assert {k: v for k, v in restored['puzzle'].items() if k != 'elapsed'} == {k: v for k, v in before['puzzle'].items() if k != 'elapsed'}, 'Old seed and placed/movable groups changed'
    assert restored['revision'] == before['revision'], 'Reading the room changed its revision'


def env_entry_key(line):
    match = re.match(rb'^[ \t]*([A-Z][A-Z0-9_]*)[ \t]*=', line)
    return match.group(1).decode('ascii') if match else None

def public_env_entries(data):
    values = {key: [] for key in PUBLIC_ENV_KEYS}
    for line in data.splitlines(keepends=True):
        key = env_entry_key(line)
        if key not in values: continue
        raw = line.partition(b'=')[2].strip()
        assert not raw.endswith(b'\\'), 'Public environment values must fit on one line'
        assert not raw.startswith((b'"', b"'")) or raw[-1:] == raw[:1], 'Public environment values must fit on one line'
        values[key].append(line)
    return values

def replace_public_env(data, replacement):
    assert set(replacement) == set(PUBLIC_ENV_KEYS)
    public_env_entries(data)  # Reject multiline values before touching the file.
    output, found = [], set()
    for line in data.splitlines(keepends=True):
        key = env_entry_key(line)
        if key not in replacement: output.append(line); continue
        if key not in found: output.extend(replacement[key]); found.add(key)
    for key in PUBLIC_ENV_KEYS:
        if key in found or not replacement[key]: continue
        if output and not output[-1].endswith((b'\r', b'\n')): output[-1] += b'\n'
        output.extend(replacement[key])
    return b''.join(output)

def public_env_value(data, key):
    # Parse only the allowlisted public paths, never source or print an env file.
    assert key in ('JIGSAW_CONTENT_DIR', 'JIGSAW_DAILY_APPEARANCES_DIR')
    lines = [line.partition(b'=')[2].decode('utf-8').strip() for line in data.splitlines() if env_entry_key(line) == key]
    assert len(lines) == 1, 'Expected one configured content path: ' + key
    parsed = shlex.split(lines[0], comments=False)
    assert len(parsed) == 1 and pathlib.Path(parsed[0]).is_absolute(), 'Invalid content path: ' + key
    return parsed[0]

def write_env_atomically(path, expected, updated):
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and not path.is_symlink(), 'Environment file must be a regular file'
    assert path.read_bytes() == expected, 'Environment changed during preparation'
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchown(handle.fileno(), info.st_uid, info.st_gid)
            os.fchmod(handle.fileno(), stat.S_IMODE(info.st_mode))
            handle.write(updated); handle.flush(); os.fsync(handle.fileno())
        assert path.read_bytes() == expected, 'Environment changed during preparation'
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def loopback_redirect(port, current, location):
    target = urllib.parse.urlsplit(urllib.parse.urljoin(current, location))
    assert target.scheme in ('http', 'https') and not target.username and not target.password, 'Unsafe acceptance redirect'
    local = target.hostname == '127.0.0.1' and target.scheme == 'http' and target.port == port
    public = target.hostname == 'jigsawnook.online' and target.port in (None, 443 if target.scheme == 'https' else 80)
    assert local or public, 'Acceptance redirect must remain on this site'
    return urllib.parse.urlunsplit(('http', f'127.0.0.1:{port}', target.path or '/', target.query, ''))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

# Retain the hashed shared UI for pages still open during a warm release.
SHARED_FILES = frozenset([
    'game.js', 'assets/audio/mobile-snap.wav',
    'assets/ui/b2-core-icons23.png', 'assets/ui/b2-task-icons23.png',
    'art/b2-supply-scenes.png', 'art/b2-pixel-atlas.png',
    'assets/fonts/OFL-NotoSansSC.txt', 'assets/fonts/FONT-NOTICES.md',
    'assets/fonts/jigsaw-ui-sc.woff2',
])

def plain_directory(path):
    if path.is_symlink() or not stat.S_ISDIR(path.lstat().st_mode):
        raise ValueError('Expected a plain directory: ' + str(path))

def retain_shared_client_hashes(old_app, next_app):
    old_app, next_app = pathlib.Path(old_app), pathlib.Path(next_app)
    old_root, next_root = old_app, next_app
    for segment in ('dist', 'client'):
        old_root, next_root = old_root / segment, next_root / segment
        plain_directory(old_root)
        plain_directory(next_root)
    old_root, next_root = old_root / 'shared-client', next_root / 'shared-client'
    if old_root.is_symlink():
        raise ValueError('Linked shared-client root')
    if not old_root.exists():
        return 0
    plain_directory(old_root)
    if not next_root.exists() and not next_root.is_symlink():
        next_root.mkdir()
    plain_directory(next_root)
    retained = 0
    for source_hash in sorted(old_root.iterdir()):
        if not re.fullmatch(r'[a-f0-9]{16}', source_hash.name):
            raise ValueError('Invalid shared-client hash directory')
        plain_directory(source_hash)
        target_hash = next_root / source_hash.name
        if not target_hash.exists() and not target_hash.is_symlink():
            target_hash.mkdir()
        plain_directory(target_hash)

        def copy_plain(source_dir, relative=pathlib.PurePosixPath()):
            nonlocal retained
            for source in sorted(source_dir.iterdir()):
                rel = relative / source.name
                mode = source.lstat().st_mode
                if source.is_symlink():
                    raise ValueError('Linked shared-client entry')
                target = target_hash.joinpath(*rel.parts)
                if stat.S_ISDIR(mode):
                    if not any(name.startswith(rel.as_posix() + '/') for name in SHARED_FILES):
                        raise ValueError('Unexpected shared-client directory')
                    if not target.exists() and not target.is_symlink():
                        target.mkdir()
                    plain_directory(target)
                    copy_plain(source, rel)
                elif stat.S_ISREG(mode):
                    if rel.as_posix() not in SHARED_FILES:
                        raise ValueError('Unexpected shared-client file')
                    if target.is_symlink():
                        raise ValueError('Linked shared-client destination')
                    if target.exists():
                        if not stat.S_ISREG(target.lstat().st_mode) or target.read_bytes() != source.read_bytes():
                            raise ValueError('Shared-client immutable collision')
                    else:
                        os.link(source, target)
                        retained += 1
                else:
                    raise ValueError('Special shared-client file')
        copy_plain(source_hash)
    return retained

p = argparse.ArgumentParser()
p.add_argument('--additive-migration-sha256')
p.add_argument('--migration-sha256', action='append', default=[], metavar='NAME=SHA256')
p.add_argument('--operator-name', help='Reviewed public operator name; must be paired with --support-email')
p.add_argument('--support-email', help='Reviewed public contact address; changes no other environment keys')
for name in ['release', 'previous', 'sha256', 'commit', 'old-unit']:
    p.add_argument('--' + name, required=True)
p.add_argument('--from-port', type=int, required=True, choices=[3103, 3104])
p.add_argument('--to-port', type=int, required=True, choices=[3103, 3104])
args = p.parse_args()
assert (args.operator_name is None) == (args.support_email is None), 'Provide both reviewed public contact fields'
if args.operator_name is not None:
    assert args.operator_name == args.operator_name.strip() and 1 <= len(args.operator_name) <= 120 and args.operator_name.isprintable()
    assert re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}", args.support_email)
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
http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
def request(port, path, body=None, actor=None, follow_redirects=True, extra_headers=None):
    assert path.startswith('/') and not path.startswith('//') and '\\' not in path
    h = dict(headers)
    if extra_headers:
        assert set(extra_headers) <= {'X-Jigsaw-Artwork-Snapshot'}, 'Acceptance headers must stay allowlisted'
        assert all(value == '1' for value in extra_headers.values()), 'Invalid artwork client capability'
        h.update(extra_headers)
    if body is not None: h['Content-Type'] = 'application/json'
    if body is not None and path.startswith('/api/shared/'):
        h['Origin'] = 'https://jigsawnook.online'
    if actor:
        if actor.get('cookie'): h['Cookie'] = actor['cookie']
        if actor.get('token'): h['Authorization'] = 'Bearer ' + actor['token']
    url, payload = f'http://127.0.0.1:{port}{path}', None if body is None else json.dumps(body).encode()
    for _ in range(8):
        req = urllib.request.Request(url, data=payload, headers=h)
        try: response = http.open(req, timeout=15)
        except urllib.error.HTTPError as error: response = error
        with response:
            status, head, raw = response.status, response.headers, response.read()
        if follow_redirects and status in (301, 302, 303, 307, 308):
            assert head.get('Location'), 'Redirect is missing a destination'
            url = loopback_redirect(port, url, head['Location'])
            if status == 303 or status in (301, 302) and payload is not None:
                payload = None; h.pop('Content-Type', None)
            continue
        return status, head, raw
    raise RuntimeError('Too many local acceptance redirects')
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
def check_game_redirect(port, path, expected='/play'):
    status, headers, _ = request(port, path, follow_redirects=False)
    assert status in (301, 302, 303, 307, 308), ('Old game entry must redirect', path, status)
    destination = urllib.parse.urlsplit(loopback_redirect(port, f'http://127.0.0.1:{port}' + path, headers.get('Location', '')))
    assert destination.path + ('?' + destination.query if destination.query else '') == expected, (path, destination)
    html = get(port, path)[1].decode()
    assert 'class="shared-game-host"' in html and 'id="game"' in html, path
    assert '使用原版大厅' not in html and '返回原版大厅' not in html, path
def check(port, all_assets=False):
    status, root_headers, _ = request(port, '/', follow_redirects=False)
    assert status in (301, 302, 303, 307, 308), 'Root must redirect to the shared game'
    destination = loopback_redirect(port, f'http://127.0.0.1:{port}/', root_headers.get('Location', ''))
    assert urllib.parse.urlsplit(destination).path == '/play', 'Unexpected root destination'
    for path in ['/', '/play']:
        html = get(port, path)[1].decode()
        assert 'class="shared-game-host"' in html and 'id="game"' in html, 'Shared game host missing'
    config = json.loads(get(port, '/api/shared/config')[1])
    assert config['mobileMode'] == 'web-managed-shared' and config['identityMode'] == 'web-cookie'
    assert config['capabilities']['energy'] is False
    assert config['gameBase'] == 'https://jigsawnook.online/play'
    assert re.fullmatch(r'/shared-client/[a-f0-9]{16}/', config['uiBase'])
    assert config['webLinks']['feedback'] == '/feedback'
    game_asset = config['uiBase'] + 'game.js'
    inventory = {i['path']: i['sha256'] for i in manifest['files']}
    assert hashlib.sha256(get(port, game_asset)[1]).hexdigest() == inventory['dist/client' + game_asset]
    for path in ['/lobby', '/zh/lobby', '/gallery', '/zh/gallery', '/personal', '/personal/images', '/albums', '/tasks', '/decorations', '/courtyard', '/puzzle/mountain-lake-reflection-hd-v3']:
        check_game_redirect(port, path)
    check_game_redirect(port, '/zh/lobby?invite=qa-code', '/play?invite=qa-code')
    for path in ['/help', '/account', '/account/security', '/privacy', '/terms', '/feedback']:
        html = get(port, path)[1].decode()
        head = html.partition('</head>')[0]
        assert 'name="msvalidate.01"' in head and 'name="google-site-verification"' in head
    if all_assets:
        for url in manifest['runtimeAssets']:
            assert hashlib.sha256(get(port, url)[1]).hexdigest() == inventory['dist/client' + url]

# This gate is read-only: no albums, rewards, daily choices or content pointer writes.
env_path = pathlib.Path('/etc/webapps/jigsaw.env')
assert env_path.is_file() and not env_path.is_symlink()
environment_initial = env_path.read_bytes()
content_directory = pathlib.Path(public_env_value(environment_initial, 'JIGSAW_CONTENT_DIR')).resolve(strict=True)
appearance_directory = pathlib.Path(public_env_value(environment_initial, 'JIGSAW_DAILY_APPEARANCES_DIR')).resolve(strict=True)
content_pointer = content_directory / 'current.json'
assert content_pointer.is_file() and not content_pointer.is_symlink()
content_pointer_before = content_pointer.read_bytes()
published = json.loads(content_pointer_before)
assert re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]{0,99}', published['releaseId'])
assert re.fullmatch(r'[a-f0-9]{64}', published['manifestSha256'])
site_before = json.loads(get(args.from_port, '/api/site-info')[1])
def check_content(port):
    assert content_pointer.read_bytes() == content_pointer_before, 'Published content changed during deployment; retry with the current release'
    health = json.loads(get(port, '/api/health')[1])
    assert health['ok'] is True and health['contentReleaseId'] == published['releaseId'], 'Runtime reader does not match the existing content pointer'
def check_public_contact(port):
    info = json.loads(get(port, '/api/site-info')[1])
    assert info['policiesReviewed'] == site_before['policiesReviewed'], 'Privacy review status must remain unchanged'
    if args.operator_name is not None:
        assert info['operator'] == args.operator_name and info['support'] == args.support_email, 'Reviewed public contact was not loaded'
check_content(args.from_port)

# Both versions run against the same disposable DB. No production player IDs,
# cookies, room writes or test chat messages are used by acceptance tests.
with tempfile.TemporaryDirectory(prefix='jigsaw-release-test-') as temporary:
    processes, logs = [], []
    def launch(root, port, managed_content=False):
        env = {'PATH': os.environ['PATH'], 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(port),
               'VINEXT_TRUSTED_HOSTS': 'jigsawnook.online', 'VINEXT_TRUST_PROXY': '1',
               'PUZZLE_PUBLIC_ORIGIN': 'https://jigsawnook.online', 'DATABASE_PATH': temporary + '/data/puzzle.sqlite', 'MIGRATIONS_DIR': str(root / 'drizzle')}
        if managed_content:
            env['JIGSAW_CONTENT_DIR'] = str(isolated_content)
            env['JIGSAW_DAILY_APPEARANCES_DIR'] = str(isolated_appearances)
        log = open(temporary + '/' + str(port) + ('-artwork' if managed_content else '') + '.log', 'a'); logs.append(log)
        processes.append(subprocess.Popen(['/usr/local/bin/node', 'server.js'], cwd=root, env=env, stdout=log, stderr=log))
        ready(port)
    def json_request(port, path, body=None, actor=None, expected=200, extra_headers=None):
        status, head, raw = request(port, path, body, actor, extra_headers=extra_headers)
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
        # The previous release can also use the shared UI; do not scrape retired gallery HTML.
        old_catalog = json.loads((old / 'content/puzzle-catalog.json').read_text())
        old_picture = next(photo['id'] for photo in old_catalog if photo['status'] == 'published' and photo['id'] == 'mountain-lake-reflection-hd-v3')
        for count in [3000, 5000]:
            actor = {}
            ticket = json_request(3139, '/api/rooms', {'visibility': 'public', 'imageId': old_picture, 'pieces': 108, 'guestSecret': secrets.token_hex(32)}, actor, 201)
            actor['token'] = ticket['token']; path = '/api/rooms/' + ticket['room']['id']
            # Seed a legacy save into the isolated DB: future versions correctly
            # reject retired counts at creation, but must continue existing games.
            with sqlite3.connect(temporary + '/data/puzzle.sqlite') as db:
                room = json.loads(db.execute('SELECT data FROM puzzle_rooms WHERE id=?', (ticket['room']['id'],)).fetchone()[0])
                # This injected pre-versioning save changes image identity; a
                # newer baseline runtime may have stamped a different artwork.
                room.pop('artwork', None)
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
            check_game_redirect(3138, '/room/' + ticket['room']['id'], '/play?room=' + ticket['room']['id'])
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
            check_game_redirect(3138, '/room/' + ticket['room']['id'], '/play?room=' + ticket['room']['id'])
        print('Isolated Linux: old rooms, cross-version moves/chat, resolution policy, shared UI routing and all assets passed.', flush=True)

        # The picture upgrade checks use copies of public content and a disposable
        # appearance directory. Neither runtime can write the live content tree.
        for process in processes: process.terminate()
        for process in processes: process.wait(timeout=15)
        processes.clear()
        isolated_content = pathlib.Path(temporary) / 'content'
        isolated_release = isolated_content / 'releases' / published['releaseId']
        isolated_release.mkdir(parents=True)
        for name in ['manifest.json', 'albums.json', 'daily.json', 'game-settings.json', 'task-rewards.json', 'assets.json']:
            source = content_directory / 'releases' / published['releaseId'] / name
            if not source.exists():
                assert name == 'assets.json', 'Published content file is missing'
                continue
            assert source.is_file() and not source.is_symlink(), 'Public content must use regular files'
            (isolated_release / name).write_bytes(source.read_bytes())
        (isolated_content / 'current.json').write_bytes(content_pointer_before)
        isolated_appearances = pathlib.Path(temporary) / 'daily-appearances'
        isolated_appearances.mkdir()
        launch(old, 3139, managed_content=True)
        launch(app, 3138, managed_content=True)
        artwork = json.loads((app / 'content/artwork-revisions.json').read_text())
        upgraded_id = next(image_id for image_id in artwork['active']
                           if any(photo['id'] == image_id and photo['status'] == 'published' for photo in old_catalog))
        legacy_artwork = artwork['legacy'][upgraded_id]
        active_artwork = next(version for version in artwork['versions'][upgraded_id]
                              if version['revision'] == artwork['active'][upgraded_id])
        capability = {'X-Jigsaw-Artwork-Snapshot': '1'}
        artwork_actor = {}
        account = json_request(3139, '/api/auth/register',
            {'username': 'artwork_' + secrets.token_hex(5), 'name': 'QA artwork', 'password': secrets.token_hex(16)}, artwork_actor, 201)['account']
        json_request(3139, '/api/shared/api/mobile/profile', actor=artwork_actor)
        # Give this test identity access only inside the isolated DB, without
        # changing album prices, live accounts or purchase/reward handlers.
        with sqlite3.connect(qa_db) as connection:
            # Profile GET is read-only and may not have persisted a wallet yet.
            # Initialize only this disposable QA identity with the exact schema-1 factory.
            row = connection.execute('SELECT data FROM puzzle_managed_players WHERE owner=?', (account['id'],)).fetchone()
            state = json.loads(row[0]) if row else json.loads('{"schema":1,"level":0,"xp":0,"totalXp":0,"coins":0,"fragments":0,"contributionTotal":0,"giftProgress":0,"giftSequence":0,"ownedAlbums":{},"ownedImages":{},"decorations":[],"equipped":null,"artworks":{},"rooms":{},"daily":{},"gifts":{},"milestones":{},"receipts":{},"invitation":null,"settlements":{}}')
            state['ownedImages'][upgraded_id] = True
            connection.execute('INSERT INTO puzzle_managed_players(owner,data,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data', (account['id'], json.dumps(state), int(time.time() * 1000)))
        old_ticket = json_request(3139, '/api/rooms',
            {'visibility': 'public', 'imageId': upgraded_id, 'pieces': 108}, artwork_actor, 201)
        artwork_actor['token'] = old_ticket['token']
        old_path = '/api/rooms/' + old_ticket['room']['id']
        json_request(3139, old_path, {'type': 'claim', 'groupId': 0}, artwork_actor)
        before = json_request(3139, old_path, {'type': 'move', 'groupId': 0, 'dx': 123, 'dy': 456, 'seq': 1}, artwork_actor)
        with sqlite3.connect(qa_db) as connection:
            stored_before = connection.execute('SELECT data FROM puzzle_rooms WHERE id=?', (old_ticket['room']['id'],)).fetchone()[0]
            wallet_before = connection.execute('SELECT data FROM puzzle_managed_players WHERE owner=?', (account['id'],)).fetchone()[0]
        # An old client requests the legacy drawing, but the previous deployment
        # may already pin it. Prove its actual pinned/unpinned room is preserved.
        assert json.loads(stored_before).get('artwork') in (None, legacy_artwork), 'Old-client creation must keep the legacy drawing'
        restored = json_request(3138, '/api/shared' + old_path, actor=artwork_actor, extra_headers=capability)
        assert_preserved_artwork_snapshot(before, restored, legacy_artwork)
        with sqlite3.connect(qa_db) as connection:
            assert connection.execute('SELECT data FROM puzzle_rooms WHERE id=?', (old_ticket['room']['id'],)).fetchone()[0] == stored_before, 'Reading old artwork must not rewrite its room'

        # Seed the actual pre-artwork storage format separately in the disposable
        # DB. Only our QA row's optional snapshot is removed. Its seed, groups,
        # positions, progress, membership, identity and revision remain intact.
        legacy_stored = pre_artwork_qa_fixture(stored_before)
        assert json.loads(legacy_stored) == {key: value for key, value in json.loads(stored_before).items() if key != 'artwork'}
        with sqlite3.connect(qa_db) as connection:
            connection.execute('UPDATE puzzle_rooms SET data=? WHERE id=?', (legacy_stored, old_ticket['room']['id']))
        # The read cache is keyed by revision/expiry. Restart only the disposable
        # new runtime so this fixture is really decoded from SQLite, rather than
        # accidentally proving the previously cached pinned snapshot again.
        fixture_runtime = processes[-1]
        fixture_runtime.terminate(); fixture_runtime.wait(timeout=15)
        processes.remove(fixture_runtime)
        launch(app, 3138, managed_content=True)
        legacy_restored = json_request(3138, '/api/shared' + old_path, actor=artwork_actor, extra_headers=capability)
        assert_preserved_artwork_snapshot(before, legacy_restored, legacy_artwork)
        with sqlite3.connect(qa_db) as connection:
            assert connection.execute('SELECT data FROM puzzle_rooms WHERE id=?', (old_ticket['room']['id'],)).fetchone()[0] == legacy_stored, 'Reading a pre-artwork fixture must not rewrite its room'

        # Already-upgraded rooms created by the actual previous runtime must also
        # keep their pinned drawing and movable groups after this code update.
        old_artwork_file = old / 'content/artwork-revisions.json'
        if old_artwork_file.exists():
            previous_artwork = json.loads(old_artwork_file.read_text())
            previous_active = next(version for version in previous_artwork['versions'][upgraded_id]
                                   if version['revision'] == previous_artwork['active'][upgraded_id])
            previous_actor = dict(artwork_actor)
            previous_ticket = json_request(3139, '/api/shared/api/rooms',
                {'visibility': 'public', 'mode': 'selected', 'imageId': upgraded_id, 'pieces': 108}, previous_actor, 201, extra_headers=capability)
            previous_actor['token'] = previous_ticket['token']
            previous_path = '/api/rooms/' + previous_ticket['room']['id']
            assert previous_ticket['room']['artwork'] == previous_active
            json_request(3139, '/api/shared' + previous_path, {'type': 'claim', 'groupId': 0}, previous_actor, extra_headers=capability)
            previous_before = json_request(3139, '/api/shared' + previous_path, {'type': 'move', 'groupId': 0, 'dx': 321, 'dy': 654, 'seq': 1}, previous_actor, extra_headers=capability)
            with sqlite3.connect(qa_db) as connection:
                previous_stored = connection.execute('SELECT data FROM puzzle_rooms WHERE id=?', (previous_ticket['room']['id'],)).fetchone()[0]
            assert json.loads(previous_stored)['artwork'] == previous_active
            previous_restored = json_request(3138, '/api/shared' + previous_path, actor=previous_actor, extra_headers=capability)
            assert_preserved_artwork_snapshot(previous_before, previous_restored, previous_active)
            with sqlite3.connect(qa_db) as connection:
                assert connection.execute('SELECT data FROM puzzle_rooms WHERE id=?', (previous_ticket['room']['id'],)).fetchone()[0] == previous_stored, 'Reading an existing upgraded room must not rewrite its room'
        new_ticket = json_request(3138, '/api/shared/api/rooms',
            {'visibility': 'public', 'mode': 'selected', 'imageId': upgraded_id, 'pieces': 108}, artwork_actor, 201, extra_headers=capability)
        assert new_ticket['room']['id'] != old_ticket['room']['id']
        assert new_ticket['room']['artwork'] == active_artwork
        assert urllib.parse.urlsplit(new_ticket['room']['photo']['src']).path == active_artwork['src']
        new_path = '/api/rooms/' + new_ticket['room']['id']
        denied = json_request(3138, '/api/shared' + new_path + '/join', {}, artwork_actor, 409)
        assert denied['code'] == 'ARTWORK_CLIENT_UPDATE_REQUIRED'
        compatibility_lobby = json_request(3138, '/api/shared/api/lobby?limit=48', actor=artwork_actor)
        assert all(room['id'] != new_ticket['room']['id'] for room in compatibility_lobby['rooms']), 'Old clients must not see incompatible upgraded tables'
        new_lobby = json_request(3138, '/api/shared/api/lobby?limit=48', actor=artwork_actor, extra_headers=capability)
        assert next(room for room in new_lobby['rooms'] if room['id'] == new_ticket['room']['id'])['thumbSrc'] == active_artwork['thumbSrc']
        gallery = json_request(3138, '/api/shared/api/mobile/gallery', actor=artwork_actor, extra_headers=capability)
        gallery_photo = next(photo for photo in gallery['photos'] if photo['id'] == upgraded_id)
        assert urllib.parse.urlsplit(gallery_photo['src']).path == active_artwork['src']
        assert (gallery_photo['width'], gallery_photo['height']) == (active_artwork['width'], active_artwork['height'])
        for url, quality in [(active_artwork['src'], 70), (active_artwork['thumbSrc'], 82)]:
            metadata = artwork['files'][url]
            assert metadata['quality'] == quality and metadata['lossless'] is False
            assert metadata['sourceSha256'] == active_artwork['revision']
            asset_headers, raw = get(3138, url)
            assert asset_headers.get_content_type() == 'image/webp' and raw[:4] == b'RIFF' and raw[8:12] == b'WEBP'
            assert len(raw) == metadata['bytes'] and hashlib.sha256(raw).hexdigest() == metadata['sha256']
        with sqlite3.connect(qa_db) as connection:
            assert connection.execute('SELECT data FROM puzzle_managed_players WHERE owner=?', (account['id'],)).fetchone()[0] == wallet_before, 'Artwork changes must not mutate wallet, collections or purchased access'
        assert content_pointer.read_bytes() == content_pointer_before
        print('Isolated artwork: actual previous pinned rooms, explicit pre-artwork fixture, new rooms, unchanged old progress, capability admission/lobby filtering, active gallery and Q70 asset hashes passed.', flush=True)
    finally:
        for process in processes: process.terminate()
        for process in processes: process.wait(timeout=15)
        for log in logs: log.close()

# Hardlink identical immutable pictures, then retain old _next/static and
# shared-client hashes for clients that have not refreshed. Never copy player data.
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

retained += retain_shared_client_hashes(old, app)

unit_path = pathlib.Path('/etc/systemd/system/jigsaw-web@.service')
# The replacement host already has the reviewed instance template and no legacy unit.
# Reuse it verbatim; only older hosts derive the template from their legacy unit.
template = unit_path.read_text() if unit_path.exists() else pathlib.Path('/etc/systemd/system/jigsaw-web.service').read_text()
template = template.replace('WorkingDirectory=/srv/sites/jigsaw/current', 'WorkingDirectory=/srv/sites/jigsaw/slots/%i').replace('Environment=PORT=3103', 'Environment=PORT=%i')
assert 'WorkingDirectory=/srv/sites/jigsaw/slots/%i' in template and 'Environment=PORT=%i' in template
assert 'EnvironmentFile=/etc/webapps/jigsaw.env' in template
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
# Validate the existing published configuration against the new delivered assets.
# This checker never selects today's picture or writes an appearance receipt.
content_check = json.loads(run('runuser', '-u', 'web-jigsaw', '--', 'env',
    'JIGSAW_CONTENT_RELEASE_DIR=' + str(content_directory / 'releases' / published['releaseId']),
    'JIGSAW_CONTENT_RELEASE_ID=' + published['releaseId'],
    'JIGSAW_CONTENT_MANIFEST_SHA256=' + published['manifestSha256'],
    '/usr/local/bin/node', str(app / 'scripts/check-content-release.mjs')))
assert content_check['ok'] is True and content_check['contentReleaseId'] == published['releaseId']
check_content(args.from_port)
def worker_pids():
    return {int(line.strip().split(None, 1)[0]) for line in run('ps', '-eo', 'pid,args').splitlines() if 'nginx: worker process' in line}
workers = worker_pids()
staged = base / 'current-warm-next'
assert not staged.exists() and not staged.is_symlink()
def point_current(target):
    staged.symlink_to(target); os.replace(staged, base / 'current')
env_original_entries = None
env_backup = None
env_changed = False
old_enabled = subprocess.run(['systemctl', 'is-enabled', '--quiet', args.old_unit]).returncode == 0
new_enabled_before = subprocess.run(['systemctl', 'is-enabled', '--quiet', new_unit]).returncode == 0
backup = pathlib.Path('/etc/systemd/system/jigsaw-backup.service')
backup_text = backup.read_text()
try:
    environment_before = env_path.read_bytes()
    assert pathlib.Path(public_env_value(environment_before, 'JIGSAW_CONTENT_DIR')).resolve() == content_directory
    assert pathlib.Path(public_env_value(environment_before, 'JIGSAW_DAILY_APPEARANCES_DIR')).resolve() == appearance_directory
    if args.operator_name is not None:
        env_original_entries = public_env_entries(environment_before)
        replacement = {key: [(key + '=' + json.dumps(value, ensure_ascii=False) + '\n').encode('utf-8')]
                       for key, value in zip(PUBLIC_ENV_KEYS, (args.operator_name, args.support_email))}
        environment_after = replace_public_env(environment_before, replacement)
        env_backup = env_path.with_name(env_path.name + '.before-' + args.release)
        descriptor = os.open(env_backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(environment_before); handle.flush(); os.fsync(handle.fileno())
        write_env_atomically(env_path, environment_before, environment_after)
        env_changed = True
    run('systemctl', 'start', new_unit)
    ready(args.to_port); check(args.to_port); check_content(args.to_port); check_public_contact(args.to_port)
    assert (base / 'current').resolve() == old and nginx.read_text() == nginx_before
    point_current(app)
    nginx.write_text(nginx_after)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    run('systemctl', 'enable', new_unit)
    drained = False
    quiet_since = None
    for _ in range(80):
        if not workers.intersection(worker_pids()):
            drained = True; break
        # Other sites may keep old global nginx workers alive with WebSockets.
        # Require 10 continuous seconds with no connection on this app's old port.
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
    if 'After=jigsaw-web.service' in backup_text:
        backup.write_text(backup_text.replace('After=jigsaw-web.service', 'After=network.target'))
        run('systemctl', 'daemon-reload')
    check(args.to_port); check_content(args.to_port); check_public_contact(args.to_port)
    report = {'release': args.release, 'gitCommit': args.commit, 'activeUnit': new_unit, 'port': args.to_port,
              'rollback': str(old), 'previousUnit': args.old_unit, 'oldAppRequestsDrained': drained,
              'assetsChecked': len(manifest['runtimeAssets']), 'retainedHashedAssets': retained,
              'reusedImmutableAssets': reused, 'reusedImmutableBytes': reused_bytes,
              'migrationChanges': bool(added), 'additiveMigrationSha256': args.additive_migration_sha256,
              'reviewedMigrationSha256': reviewed_migrations, 'isolatedCrossVersionTests': True, 'forcedClientRefresh': False,
              'contentReleaseId': published['releaseId'], 'contentPointerUnchanged': True,
              'publicContactUpdated': env_changed, 'environmentBackup': str(env_backup) if env_backup else None,
              'policiesReviewed': site_before['policiesReviewed']}
    (release / 'deployment.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
except BaseException:
    # Restore only these two public keys; concurrent edits to other keys survive.
    # The full original file remains in the private 0600 backup for manual recovery.
    rollback_errors = []
    def rollback_step(name, operation):
        try: operation()
        except BaseException: rollback_errors.append(name)
    def restore_public_environment():
        if not env_changed: return
        current = env_path.read_bytes()
        write_env_atomically(env_path, current, replace_public_env(current, env_original_entries))
    rollback_step('public contact environment', restore_public_environment)
    rollback_step('restart previous service', lambda: run('systemctl', 'start', args.old_unit))
    if old_enabled: rollback_step('enable previous service', lambda: run('systemctl', 'enable', args.old_unit))
    rollback_step('previous service health', lambda: ready(args.from_port))
    def restore_routing():
        if staged.is_symlink(): staged.unlink()
        point_current(old); nginx.write_text(nginx_before)
        run('nginx', '-t'); run('systemctl', 'reload', 'nginx')
    rollback_step('previous routing', restore_routing)
    rollback_step('stop replacement service', lambda: run('systemctl', 'stop', new_unit))
    if not new_enabled_before: rollback_step('disable replacement service', lambda: run('systemctl', 'disable', new_unit))
    if backup.read_text() != backup_text:
        rollback_step('backup service definition', lambda: backup.write_text(backup_text))
        rollback_step('reload service definitions', lambda: run('systemctl', 'daemon-reload'))
    if rollback_errors:
        raise RuntimeError('Deployment failed; manual recovery needed for: ' + ', '.join(rollback_errors))
    raise
