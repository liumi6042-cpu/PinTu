import sqlite3,json,pathlib,time
base=pathlib.Path('/srv/sites/jigsaw-mobile-v3/shared')
db=sqlite3.connect(str(base/'mobile-v3.sqlite'),timeout=10)
source='admin:test-grant:20261020:taptap-screenshot:coins10000'
db.execute('BEGIN IMMEDIATE')
try:
 row=db.execute('SELECT owner,data FROM mobile_rooms WHERE id=?',('5e5533ce59134fb79ca8a44c34beec14',)).fetchone()
 assert row and json.loads(row[1]).get('adminFixture')=='screenshot-room-20261020-cat-flower'
 owner=row[0]
 accounts=db.execute('SELECT nickname FROM mobile_taptap_accounts WHERE canonical_identity=?',(owner,)).fetchall()
 assert len(accounts)==1 and accounts[0][0]=='老头','Test identity mismatch'
 wallet=db.execute('SELECT coins,fragments,equipped FROM mobile_collection_wallets WHERE owner=?',(owner,)).fetchone()
 assert wallet is not None,'Missing wallet'
 previous=db.execute('SELECT coins,fragments FROM mobile_collection_ledger WHERE owner=? AND source=?',(owner,source)).fetchone()
 if previous:
  assert previous==(10000,0)
  db.rollback()
  print(json.dumps({'alreadyApplied':True,'coins':wallet[0]},ensure_ascii=False))
 else:
  op=base/'operations'/'20261020-taptap-coins10000';op.mkdir(mode=0o700,parents=True,exist_ok=True)
  backup=op/'before.json'
  with backup.open('x',encoding='utf8') as f:json.dump({'owner':owner,'wallet':wallet,'source':source},f,ensure_ascii=False)
  backup.chmod(0o600)
  now=int(time.time()*1000)
  db.execute('INSERT INTO mobile_collection_ledger(owner,source,coins,fragments,created_at) VALUES(?,?,?,?,?)',(owner,source,10000,0,now))
  db.execute('UPDATE mobile_collection_wallets SET coins=coins+10000 WHERE owner=?',(owner,))
  after=db.execute('SELECT coins,fragments,equipped FROM mobile_collection_wallets WHERE owner=?',(owner,)).fetchone()
  assert after[0]==wallet[0]+10000 and after[1:]==wallet[1:]
  db.commit();db.close()
  verify=sqlite3.connect('file:'+str(base/'mobile-v3.sqlite')+'?mode=ro',uri=True)
  actual=verify.execute('SELECT coins,fragments,equipped FROM mobile_collection_wallets WHERE owner=?',(owner,)).fetchone()
  assert actual==after
  result={'account':'老头','added':10000,'before':wallet[0],'after':actual[0],'fragmentsUnchanged':True,'source':source}
  (op/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
  print(json.dumps(result,ensure_ascii=False))
except:
 if db: 
  try:db.rollback()
  except:pass
 raise
