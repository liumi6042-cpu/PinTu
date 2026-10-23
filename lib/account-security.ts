import { localDb } from './local-db';
import { requireAccount } from './account-store';
import { equalHash,passwordHash,randomSecret,tokenHash,usernameOf } from './account-crypto';
import { RoomError } from './room-engine';

const RECOVERY_DAYS=180;
const readLimits=new Map<string,{hits:number;expiresAt:number}>();
export async function securityLimit(scope:string, identity:string, maximum=8, options:{readOnly?:boolean}={}) {
  // Pure read endpoints cannot persist rate counters. This budget is per process.
  if(options.readOnly){
    const now=Date.now(),key=scope+':'+await tokenHash(identity);
    for(const [id,rate] of readLimits)if(rate.expiresAt<=now)readLimits.delete(id);
    const rate=readLimits.get(key)??{hits:0,expiresAt:now+60000};readLimits.set(key,rate);
    if(++rate.hits>maximum)throw new RoomError('尝试次数过多，请 1 分钟后再试',429);
    return;
  }
  const db=localDb(),now=Date.now(),key=scope+':'+await tokenHash(identity);
  const result=await db.batch([db.prepare(`INSERT INTO puzzle_request_limits (key,hits,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).bind(key,now+900000,now,now),db.prepare('SELECT hits FROM puzzle_request_limits WHERE key=?').bind(key)]);
  const row=result[1].results[0] as {hits:number}|undefined;
  if(!row||row.hits>maximum)throw new RoomError('尝试次数过多，请 15 分钟后再试',429);
  if(Math.random()<.02)await db.prepare('DELETE FROM puzzle_request_limits WHERE expires_at<?').bind(now).run();
}
export async function verifiedPassword(request:Request,password:unknown) {
  const account=await requireAccount(request);
  await securityLimit('password-check',account.id,12);
  const row=await localDb().prepare('SELECT password_hash,salt FROM puzzle_users WHERE id=?').bind(account.id).first<{password_hash:string;salt:string}>();
  if(typeof password!=='string'||password.length>128||!row||!equalHash(await passwordHash(password,row.salt),row.password_hash))throw new RoomError('当前密码不正确',403);
  return {account,hash:row.password_hash};
}
function newPassword(value:unknown):string {
  if(typeof value!=='string'||value.length<8||value.length>128)throw new RoomError('密码需为 8–128 个字符');
  return value;
}
export async function securitySummary(request:Request) {
  const account=await requireAccount(request),db=localDb();
  const [security,privacy]=await Promise.all([
    db.prepare('SELECT recovery_hash IS NOT NULL AND recovery_expires_at>? AS recovery_ready,recovery_expires_at FROM puzzle_account_security WHERE user_id=?').bind(Date.now(),account.id).first(),
    db.prepare('SELECT status,created_at,updated_at,resolution FROM puzzle_privacy_requests WHERE user_id=?').bind(account.id).first()
  ]);
  return {account,recoveryReady:!!security?.recovery_ready,recoveryExpiresAt:security?.recovery_expires_at||null,privacy};
}
export async function rotateRecovery(request:Request,input:Record<string,unknown>) {
  const {account,hash}=await verifiedPassword(request,input.password),secret=randomSecret(),now=Date.now(),expiresAt=now+RECOVERY_DAYS*86400000;
  const result=await localDb().prepare(`INSERT INTO puzzle_account_security (user_id,recovery_hash,recovery_expires_at)
    SELECT id,?,? FROM puzzle_users WHERE id=? AND password_hash=?
    ON CONFLICT(user_id) DO UPDATE SET recovery_hash=excluded.recovery_hash,recovery_expires_at=excluded.recovery_expires_at WHERE status='active'`)
    .bind(await tokenHash(secret),expiresAt,account.id,hash).run();
  if(result.meta.changes!==1)throw new RoomError('账号状态已变化，请重新登录',409);
  return {code:secret.match(/.{1,8}/g)!.join('-'),expiresAt};
}
export async function changePassword(request:Request,input:Record<string,unknown>) {
  const next=newPassword(input.newPassword),{account,hash}=await verifiedPassword(request,input.password),salt=randomSecret(),nextHash=await passwordHash(next,salt),db=localDb();
  const rows=await db.batch([
    db.prepare('UPDATE puzzle_users SET password_hash=?,salt=? WHERE id=? AND password_hash=?').bind(nextHash,salt,account.id,hash),
    db.prepare('DELETE FROM puzzle_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM puzzle_users WHERE id=? AND password_hash=?)').bind(account.id,account.id,nextHash),
    db.prepare('UPDATE puzzle_account_security SET recovery_hash=NULL,recovery_expires_at=NULL WHERE user_id=? AND EXISTS(SELECT 1 FROM puzzle_users WHERE id=? AND password_hash=?)').bind(account.id,account.id,nextHash)
  ]);
  if(rows[0].meta.changes!==1)throw new RoomError('账号状态已变化，请重新登录',409);
}
export async function recoverPassword(input:Record<string,unknown>) {
  const username=usernameOf(input.username),password=newPassword(input.newPassword);
  await securityLimit('recovery',username);
  const code=typeof input.code==='string'?input.code.replace(/-/g,'').trim().toLowerCase():'';
  if(!/^[a-f0-9]{64}$/.test(code))throw new RoomError('恢复码无效、已使用或已过期',403);
  const db=localDb(),digest=await tokenHash(code),now=Date.now(),salt=randomSecret(),hash=await passwordHash(password,salt);
  const account=await db.prepare('SELECT id FROM puzzle_users WHERE username=?').bind(username).first<{id:string}>();
  const id=account?.id||'missing';
  const valid="EXISTS(SELECT 1 FROM puzzle_account_security WHERE user_id=? AND recovery_hash=? AND recovery_expires_at>? AND status='active')";
  const rows=await db.batch([
    db.prepare(`UPDATE puzzle_users SET password_hash=?,salt=? WHERE id=? AND ${valid}`).bind(hash,salt,id,id,digest,now),
    db.prepare(`DELETE FROM puzzle_sessions WHERE user_id=? AND ${valid}`).bind(id,id,digest,now),
    db.prepare("UPDATE puzzle_account_security SET recovery_hash=NULL,recovery_expires_at=NULL WHERE user_id=? AND recovery_hash=? AND recovery_expires_at>? AND status='active'").bind(id,digest,now),
    db.prepare('DELETE FROM puzzle_login_attempts WHERE username=? AND EXISTS(SELECT 1 FROM puzzle_users WHERE id=? AND password_hash=?)').bind(username,id,hash)
  ]);
  if(rows[0].meta.changes!==1)throw new RoomError('恢复码无效、已使用或已过期',403);
}
export async function privacyRequest(request:Request,input:Record<string,unknown>) {
  const {account}=await verifiedPassword(request,input.password);
  const status=input.cancel===true?'cancelled':'pending',now=Date.now();
  const result=await localDb().prepare(`INSERT INTO puzzle_privacy_requests (user_id,status,created_at,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,resolution=NULL WHERE status!='completed'`).bind(account.id,status,now,now).run();
  if(result.meta.changes!==1)throw new RoomError('申请状态已变化，请刷新后查看处理结果',409);
  return {status};
}
