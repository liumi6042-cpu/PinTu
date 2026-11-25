import pathlib,json,subprocess,base64
root=pathlib.Path(__file__).resolve().parents[2];work=pathlib.Path(__file__).resolve().parent
cfg=json.loads((root/'content-admin/work/publish-config.json').read_text(encoding='utf-8-sig'))
opts=['-i',cfg['identityFile'],'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12']
def remote(script):
 r=subprocess.run(['ssh',*opts,cfg['host'],'python3','-'],input=script,capture_output=True,text=True,encoding='utf8',check=True)
 return json.loads(r.stdout)
if __name__=='__main__':
 data=remote('''import pathlib,json,sqlite3,subprocess,hashlib,base64
b=pathlib.Path('/srv/sites/jigsaw');c=(b/'current').resolve();db=sqlite3.connect('file:'+str(b/'shared/puzzle.sqlite')+'?mode=ro',uri=True)
rows=db.execute("SELECT id,username,name FROM puzzle_users WHERE username=?",('devgod',)).fetchall()
assert len(rows)==1 and rows[0][2]=='羊咩咩', 'Account not uniquely matched'
print(json.dumps({'current':str(c),'manifest':base64.b64encode((c/'release.json').read_bytes()).decode(),'accountMatched':True,'accountName':rows[0][2],'units':subprocess.check_output(['systemctl','is-active','jigsaw-web@3103.service','jigsaw-web@3104.service'],text=True).strip().splitlines(),'contentPointerSha256':hashlib.sha256(pathlib.Path('/srv/sites/jigsaw-content/current.json').read_bytes()).hexdigest()}))
''')
 (work/'baseline-manifest.json').write_bytes(base64.b64decode(data.pop('manifest')))
 (work/'inspection.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
 print(json.dumps(data,ensure_ascii=False));m=json.loads((work/'baseline-manifest.json').read_bytes());print(json.dumps({k:m[k] for k in ['gitCommit','createdAt'] if k in m}))
