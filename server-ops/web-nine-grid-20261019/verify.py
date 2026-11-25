import json,pathlib,hashlib,urllib.request
from inspect import remote
here=pathlib.Path(__file__).resolve().parent
http=urllib.request.build_opener(urllib.request.ProxyHandler({}))
http.addheaders=[('User-Agent','Mozilla/5.0')]
data=remote('''import pathlib,json,sqlite3,hashlib
b=pathlib.Path('/srv/sites/jigsaw');c=(b/'current').resolve();live=sqlite3.connect('file:'+str(b/'shared/puzzle.sqlite')+'?mode=ro',uri=True);backup=sqlite3.connect('file:'+str(b/'shared/operations/web-20261019-nine-grid/puzzle.sqlite')+'?mode=ro',uri=True)
actor=live.execute('SELECT id FROM puzzle_users WHERE username=?',('devgod',)).fetchone()[0]
before=backup.execute('SELECT data FROM puzzle_managed_players WHERE owner=?',(actor,)).fetchone();after=live.execute('SELECT data FROM puzzle_managed_players WHERE owner=?',(actor,)).fetchone()
allowed=[]
for line in pathlib.Path('/etc/webapps/jigsaw.env').read_text().splitlines():
 if line.startswith('PUZZLE_DIAGNOSTIC_ACCOUNT_IDS='):allowed=line.split('=',1)[1].split(',')
row=live.execute('SELECT data FROM puzzle_diagnostic_rooms WHERE owner=? AND closed=0',(actor,)).fetchone();room=json.loads(row[0]) if row else None
report=json.loads((c.parent/'deployment.json').read_bytes());print(json.dumps({'current':str(c),'slotMatchesCurrent':(b/'slots/3104').resolve()==c,'accountWhitelisted':actor in allowed,'managedProfileIdenticalToBeforeDeploy':before==after,'currentDiagnosticRoom':bool(room and room.get('diagnostic')),'diagnosticPlacedPieces':sum(len(g['pieces']) for g in room['puzzle']['groups'] if g['locked']) if room else 0,'diagnosticRoomExcludedFromNormalDirectory':not room or live.execute('SELECT COUNT(*) FROM puzzle_room_directory WHERE room_id=?',(room['id'],)).fetchone()[0]==0,'contentPointerSha256':hashlib.sha256(pathlib.Path('/srv/sites/jigsaw-content/current.json').read_bytes()).hexdigest(),'deployment':report}))
''')
with http.open('https://jigsawnook.online/api/health',timeout=15) as res:data['publicHealth']=json.load(res)
with http.open('https://jigsawnook.online/api/shared/config',timeout=15) as res:data['publicConfig']=json.load(res)
with http.open('https://jigsawnook.online/shared-client/bb55eb8378ab32aa/game.js',timeout=20) as res:data['publicGameSha256']=hashlib.sha256(res.read()).hexdigest()
target=json.loads((here/'target-manifest.json').read_bytes());expected=next(f['sha256'] for f in target['files'] if f['path']=='dist/client/shared-client/bb55eb8378ab32aa/game.js');assert data['publicGameSha256']==expected
assert data['slotMatchesCurrent'] and data['accountWhitelisted'] and data['managedProfileIdenticalToBeforeDeploy'] and data['diagnosticRoomExcludedFromNormalDirectory']
assert data['contentPointerSha256']==json.loads((here/'inspection.json').read_bytes())['contentPointerSha256']
(here/'verification.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in data.items() if k not in ['publicConfig','deployment']},ensure_ascii=False))
