import {randomBytes} from 'node:crypto';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const TYPES=new Set(['access','delete']);
const publicView=row=>({requestId:row.request_id,type:row.type,status:row.status,createdAt:row.created_at,verificationCode:row.verification_code});

/** The gateway has already authenticated request.identity. The enclosing mobile
 * service owns the transaction; this module never begins a nested transaction.
 * A request is a manual-review task, never a claim that player data was deleted.
 */
export function createMobilePrivacy({db}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_privacy_requests(
  request_id TEXT PRIMARY KEY,owner TEXT NOT NULL,type TEXT NOT NULL,
  verification_code TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS mobile_privacy_owner ON mobile_privacy_requests(owner,created_at);
 CREATE INDEX IF NOT EXISTS mobile_privacy_status ON mobile_privacy_requests(status,created_at);
 CREATE TABLE IF NOT EXISTS mobile_privacy_receipts(
  owner TEXT NOT NULL,client_request_id TEXT NOT NULL,type TEXT NOT NULL,
  request_id TEXT NOT NULL,created_at INTEGER NOT NULL,
  PRIMARY KEY(owner,client_request_id));
 `);
 function route(request,input,now){
  const owner=request.identity;
  if(request.method==='GET'){
   return {requests:db.prepare('SELECT * FROM mobile_privacy_requests WHERE owner=? ORDER BY created_at DESC,request_id DESC LIMIT 10').all(owner).map(publicView),serverTime:now};
  }
  if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方式无效');
  if(Object.keys(input).some(key=>!['requestId','type'].includes(key)))fail(400,'INVALID_PRIVACY_REQUEST','申请仅需选择访问或删除数据，无需填写邮箱、令牌或其他文字');
  if(typeof input.requestId!=='string'||!/^[a-f0-9]{32}$/.test(input.requestId))fail(400,'REQUEST_ID_REQUIRED','缺少有效请求编号，请重试');
  if(!TYPES.has(input.type))fail(400,'INVALID_PRIVACY_REQUEST','请选择访问或删除数据申请');
  const receipt=db.prepare('SELECT type,request_id FROM mobile_privacy_receipts WHERE owner=? AND client_request_id=?').get(owner,input.requestId);
  if(receipt){
   if(receipt.type!==input.type)fail(409,'REQUEST_CONFLICT','同一请求编号不能用于其他操作');
   const row=db.prepare('SELECT * FROM mobile_privacy_requests WHERE request_id=? AND owner=?').get(receipt.request_id,owner);
   if(!row)fail(409,'PRIVACY_REQUEST_UNAVAILABLE','该申请需由客服核对，请勿重复发送凭证');
   return {request:publicView(row),duplicate:true,serverTime:now};
  }
  // Coalescing pending requests prevents a stream of duplicate support tasks.
  // Receipts are also bounded, while exact retries remain available at the limit.
  const recent=Number(db.prepare('SELECT COUNT(*) n FROM mobile_privacy_receipts WHERE owner=? AND created_at>?').get(owner,now-86400000).n);
  if(recent>=10)fail(429,'PRIVACY_REQUEST_RATE_LIMIT','今日申请操作较多，请使用已有申请编号联系管理员');
  let row=db.prepare("SELECT * FROM mobile_privacy_requests WHERE owner=? AND type=? AND status IN ('pending','in_review') ORDER BY created_at DESC LIMIT 1").get(owner,input.type);
  const duplicate=Boolean(row);
  if(!row){
   const count=Number(db.prepare('SELECT COUNT(*) n FROM mobile_privacy_requests WHERE owner=? AND created_at>?').get(owner,now-86400000).n);
   if(count>=3)fail(429,'PRIVACY_REQUEST_RATE_LIMIT','今日申请较多，请使用已有申请编号联系管理员');
   row={request_id:randomBytes(16).toString('hex'),owner,type:input.type,verification_code:randomBytes(10).toString('hex').toUpperCase(),status:'pending',created_at:now,updated_at:now};
   db.prepare('INSERT INTO mobile_privacy_requests VALUES(?,?,?,?,?,?,?)').run(row.request_id,row.owner,row.type,row.verification_code,row.status,row.created_at,row.updated_at);
  }
  db.prepare('INSERT INTO mobile_privacy_receipts VALUES(?,?,?,?,?)').run(owner,input.requestId,input.type,row.request_id,now);
  return {request:publicView(row),duplicate,serverTime:now};
 }
 return {route};
}

/** Server-local, read-only review lookup. The random support code is not an
 * authentication/session token and alone must never authorize deletion.
 * Keep this helper out of public HTTP routes and client bundles.
 */
export function readMobilePrivacyReview(db,{requestId,verificationCode}){
 if(typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId)||typeof verificationCode!=='string'||!/^[A-F0-9]{20}$/.test(verificationCode))return null;
 const row=db.prepare('SELECT * FROM mobile_privacy_requests WHERE request_id=? AND verification_code=?').get(requestId,verificationCode);
 return row?{...publicView(row),owner:row.owner,updatedAt:row.updated_at}:null;
}
