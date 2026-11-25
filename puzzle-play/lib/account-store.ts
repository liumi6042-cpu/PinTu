import { localDb } from './local-db';
import { RoomError } from './room-engine';
import { equalHash, passwordHash, randomSecret, registration, sessionToken, tokenHash, usernameOf, SESSION_SECONDS, type Account } from './account-crypto';
type UserRow={id:string;username:string;name:string;password_hash:string;salt:string};
export async function currentAccount(request:Request):Promise<Account|null>{const token=sessionToken(request);if(!token)return null;return localDb().prepare("SELECT u.id,u.username,u.name FROM puzzle_users u JOIN puzzle_sessions s ON s.user_id=u.id LEFT JOIN puzzle_account_security a ON a.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND COALESCE(a.status,'active')='active'").bind(await tokenHash(token),Date.now()).first<Account>();}
export async function requireAccount(request:Request){const account=await currentAccount(request);if(!account)throw new RoomError('请先登录本地账号',401);return account;}
async function session(account:Account){const token=randomSecret();await localDb().prepare('INSERT INTO puzzle_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await tokenHash(token),account.id,Date.now()+SESSION_SECONDS*1000).run();return {account,token};}
export async function registerAccount(input:Record<string,unknown>){const value=registration(input),id=crypto.randomUUID().replaceAll('-',''),salt=randomSecret(),hash=await passwordHash(value.password,salt);try{await localDb().prepare('INSERT INTO puzzle_users (id,username,name,password_hash,salt,created_at) VALUES (?,?,?,?,?,?)').bind(id,value.username,value.name,hash,salt,Date.now()).run();}catch(error){if(String(error).includes('UNIQUE'))throw new RoomError('这个账号已经注册，请换一个或直接登录',409);throw error;}return session({id,username:value.username,name:value.name});}
export async function loginAccount(input:Record<string,unknown>){
 const username=usernameOf(input.username);if(typeof input.password!=='string'||input.password.length>128)throw new RoomError('账号或密码不正确',401);
 const database=localDb(),now=Date.now(),attempt=await database.prepare('SELECT failures,expires_at FROM puzzle_login_attempts WHERE username=?').bind(username).first<{failures:number;expires_at:number}>();
 if(attempt&&attempt.expires_at>now&&attempt.failures>=8)throw new RoomError('尝试次数过多，请 15 分钟后再试',429);
 const row=await database.prepare('SELECT id,username,name,password_hash,salt FROM puzzle_users WHERE username=?').bind(username).first<UserRow>();
 const hash=await passwordHash(input.password,row?.salt||'unregistered-user-timing-salt');
 if(!row||!equalHash(hash,row.password_hash)){await database.prepare('INSERT INTO puzzle_login_attempts (username,failures,expires_at) VALUES (?,1,?) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN expires_at<=? THEN 1 ELSE failures+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').bind(username,now+900000,now,now).run();throw new RoomError('账号或密码不正确',401);}
 const security=await database.prepare('SELECT status FROM puzzle_account_security WHERE user_id=?').bind(row.id).first<{status:string}>();if(security?.status==='suspended')throw new RoomError('账号已暂停使用，请联系支持',403);
 await database.prepare('DELETE FROM puzzle_login_attempts WHERE username=?').bind(username).run();return session({id:row.id,username:row.username,name:row.name});
}
export async function logoutAccount(request:Request){const token=sessionToken(request);if(token)await localDb().prepare('DELETE FROM puzzle_sessions WHERE token_hash=?').bind(await tokenHash(token)).run();}
