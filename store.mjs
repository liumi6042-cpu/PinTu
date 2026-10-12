import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const newId=()=>randomUUID().replaceAll('-','');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const problem=(status,message,code='INVALID_REQUEST')=>Object.assign(new Error(message),{status,code});
const draftView=row=>row&&({id:row.id,name:row.name,revision:row.revision,sourceFingerprint:row.source_fingerprint,updatedAt:row.updated_at,document:JSON.parse(row.document)});
const versionView=row=>row&&({id:row.id,label:row.label,kind:row.kind,target:row.target,createdAt:row.created_at,sourceFingerprint:row.source_fingerprint,sha256:row.sha256,summary:JSON.parse(row.summary),reason:row.reason});

export function createStore(dataDir,source){
 mkdirSync(dataDir,{recursive:true});
 const db=new DatabaseSync(join(dataDir,'admin.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS admin_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,salt TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES admin_users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS content_drafts(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,source_fingerprint TEXT NOT NULL,document TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS content_versions(id TEXT PRIMARY KEY,label TEXT NOT NULL,kind TEXT NOT NULL,target TEXT,created_at INTEGER NOT NULL,source_fingerprint TEXT NOT NULL,document TEXT NOT NULL,files TEXT NOT NULL,summary TEXT NOT NULL,reason TEXT NOT NULL,sha256 TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS content_audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS content_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS content_source_baselines(fingerprint TEXT PRIMARY KEY,document TEXT NOT NULL);
 `);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
 function audit(actor,action,target,reason=''){db.prepare('INSERT INTO content_audit VALUES(?,?,?,?,?,?)').run(newId(),actor,action,target,reason,Date.now());}
 function selectDraft(id){const result=draftView(db.prepare('SELECT * FROM content_drafts WHERE id=?').get(id));if(!result)throw problem(404,'草稿不存在','DRAFT_NOT_FOUND');return result;}
 function addDraft(document,fingerprint,actor,reason='',action='create-draft'){
  const id=newId(),now=Date.now();
  db.prepare('INSERT INTO content_drafts VALUES(?,?,?,?,?,?)').run(id,document.name,1,fingerprint,JSON.stringify(document),now);
  db.prepare('INSERT INTO content_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('active-draft',id);
  audit(actor,action,id,reason);return selectDraft(id);
 }
 if(!db.prepare('SELECT 1 FROM content_drafts LIMIT 1').get())transaction(()=>addDraft(source.baseline,source.fingerprint,'system','只读导入现有内容','import-baseline'));
 db.prepare('INSERT OR IGNORE INTO content_source_baselines VALUES(?,?)').run(source.fingerprint,JSON.stringify(source.baseline));
 return {
  db,transaction,audit,
  hasAdmin:()=>!!db.prepare('SELECT 1 FROM admin_users LIMIT 1').get(),
  userByName:name=>db.prepare('SELECT * FROM admin_users WHERE username=?').get(name),
  userById:id=>db.prepare('SELECT * FROM admin_users WHERE id=?').get(id),
  addAdmin(username,passwordHash,salt){return transaction(()=>{if(this.hasAdmin())throw problem(409,'管理员已初始化，请登录','SETUP_COMPLETED');const id=newId();db.prepare('INSERT INTO admin_users VALUES(?,?,?,?,?)').run(id,username,passwordHash,salt,Date.now());audit(username,'initialize-admin',id);return this.userById(id);});},
  addSession(token,userId,csrf,expiresAt){db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(Date.now());db.prepare('INSERT INTO admin_sessions VALUES(?,?,?,?)').run(digest(token),userId,csrf,expiresAt);},
  session(token){if(!token)return null;return db.prepare('SELECT s.csrf,s.expires_at,u.id,u.username FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now())??null;},
  removeSession:token=>db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(token)),
  listDrafts:()=>db.prepare('SELECT id,name,revision,updated_at AS updatedAt FROM content_drafts ORDER BY updated_at DESC,id').all(),
  activeDraftId:()=>db.prepare("SELECT value FROM content_meta WHERE key='active-draft'").get()?.value,
  draft:selectDraft,
  historicalIds(){const ids=new Set();for(const row of db.prepare('SELECT document FROM content_source_baselines').all())for(const id of Object.keys(JSON.parse(row.document).assets))ids.add(id);return [...ids];},
  baseline(fingerprint){const row=db.prepare('SELECT document FROM content_source_baselines WHERE fingerprint=?').get(fingerprint);if(!row)throw problem(409,'缺少该草稿的原始导入基线，请先保留规划快照并人工合并','BASELINE_MISSING');return JSON.parse(row.document);},
  createDraft(document,fingerprint,actor){return transaction(()=>addDraft(document,fingerprint,actor));},
  importPendingDraft(fromId,revision,document,latest,reason){return transaction(()=>{if(selectDraft(fromId).revision!==revision)throw problem(409,'原草稿已变化，请重新合并','REVISION_CONFLICT');db.prepare('INSERT OR IGNORE INTO content_source_baselines VALUES(?,?)').run(latest.fingerprint,JSON.stringify(latest.baseline));return addDraft(document,latest.fingerprint,'local-content-import',reason,'import-pending-assets');});},
  saveDraft(id,revision,document,actor){return transaction(()=>{selectDraft(id);const result=db.prepare('UPDATE content_drafts SET name=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(document.name,JSON.stringify(document),Date.now(),id,revision);if(!result.changes)throw problem(409,'草稿已在其他窗口更新；请保留当前编辑，重新加载后合并','REVISION_CONFLICT');audit(actor,'save-draft',id);return selectDraft(id);});},
  reimport(id,revision,document,latest,actor,why){return transaction(()=>{const result=db.prepare('UPDATE content_drafts SET name=?,document=?,source_fingerprint=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(document.name,JSON.stringify(document),latest.fingerprint,Date.now(),id,revision);if(!result.changes)throw problem(409,'草稿已变化，请重新加载后再合并','REVISION_CONFLICT');db.prepare('INSERT OR IGNORE INTO content_source_baselines VALUES(?,?)').run(latest.fingerprint,JSON.stringify(latest.baseline));audit(actor,'reimport-source',id,why);return selectDraft(id);});},
  listVersions:()=>db.prepare('SELECT * FROM content_versions ORDER BY created_at DESC,id').all().map(versionView),
  version(id){const row=db.prepare('SELECT * FROM content_versions WHERE id=?').get(id);if(!row)throw problem(404,'版本不存在','VERSION_NOT_FOUND');return {version:versionView(row),document:JSON.parse(row.document),files:JSON.parse(row.files)};},
  publish(draft,options,files,analysis,actor){return transaction(()=>{
   if(selectDraft(draft.id).revision!==draft.revision)throw problem(409,'发布前草稿已变化，请重新检查','REVISION_CONFLICT');
   const summary={changes:analysis.changes.length,blockers:analysis.blockers.length,warnings:analysis.warnings.length,compatibleTargets:analysis.compatibleTargets};
   const content=JSON.stringify({sourceFingerprint:draft.sourceFingerprint,document:draft.document,files});
   const sha256=digest(content);
   // A retry of the same saved revision/target does not create another version.
   const existing=db.prepare('SELECT * FROM content_versions WHERE sha256=? AND kind=? AND target IS ?').get(sha256,options.kind,options.target);
   if(existing)return versionView(existing);
   const id=newId();db.prepare('INSERT INTO content_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,options.label,options.kind,options.target,Date.now(),draft.sourceFingerprint,JSON.stringify(draft.document),JSON.stringify(files),JSON.stringify(summary),options.reason,sha256);
   audit(actor,options.kind==='candidate'?'generate-candidate':'save-snapshot',id,options.reason);return versionView(db.prepare('SELECT * FROM content_versions WHERE id=?').get(id));
  });},
  restore(id,name,actor,reason){const saved=this.version(id);const document=structuredClone(saved.document);document.name=name;return transaction(()=>addDraft(document,saved.version.sourceFingerprint,actor,reason,'restore-version'));},
  listAudit:()=>db.prepare('SELECT actor,action,target,reason,created_at AS createdAt FROM content_audit ORDER BY created_at DESC,id LIMIT 100').all(),
  close:()=>db.close()
 };
}
