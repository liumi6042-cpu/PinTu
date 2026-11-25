import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {problem} from './store.mjs';

const secret=()=>randomBytes(32).toString('hex');
const derive=(password,salt)=>scryptSync(password,salt,64).toString('hex');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const validPassword=password=>typeof password==='string'&&password.length>=10&&password.length<=128;
export function createAuth(store){
 const attempts=new Map();
 function limit(key,max=10){const now=Date.now(),window=attempts.get(key);if(window&&now-window.start<15*60e3){if(window.count>=max)throw problem(429,'尝试次数过多，请在 15 分钟后重试','RATE_LIMIT');window.count++;}else attempts.set(key,{start:now,count:1});if(attempts.size>1000)for(const [k,v] of attempts)if(now-v.start>=15*60e3)attempts.delete(k);}
 function tokenFrom(req){const cookies=String(req.headers.cookie??'').split(';');const value=cookies.find(s=>s.trim().startsWith('content_admin_session='))?.trim().slice('content_admin_session='.length);return /^[a-f0-9]{64}$/.test(value??'')?value:null;}
 function session(req){return store.session(tokenFrom(req));}
 function requireSession(req){const current=session(req);if(!current)throw problem(401,'请先登录内容管理员','LOGIN_REQUIRED');return current;}
 function establish(user,res){const token=secret(),csrf=secret(),expires=Date.now()+12*60*60e3;store.addSession(token,user.id,csrf,expires);res.setHeader('Set-Cookie',`content_admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`);return {authenticated:true,setupRequired:false,csrfToken:csrf,user:{username:user.username}};}
 return {
  session,requireSession,
  state(req){const current=session(req);return {authenticated:!!current,setupRequired:!store.hasAdmin(),csrfToken:current?.csrf??null,user:current?{username:current.username}:null};},
  verifyCsrf(req,current){if(!equal(req.headers['x-csrf-token'],current.csrf))throw problem(403,'操作校验已失效，请刷新页面后重试','CSRF_REJECTED');},
  setup(req,res,input){limit('setup');if(store.hasAdmin())throw problem(409,'管理员已初始化，请登录','SETUP_COMPLETED');if(typeof input.username!=='string'||!/^[\p{L}\p{N}_.-]{2,40}$/u.test(input.username))throw problem(400,'管理员名称需为 2–40 位文字、数字、点、下划线或连字符');if(!validPassword(input.password))throw problem(400,'密码需为 10–128 个字符');const salt=secret(),user=store.addAdmin(input.username,derive(input.password,salt),salt);return establish(user,res);},
  login(req,res,input){limit('login');if(typeof input.username!=='string'||input.username.length>40||typeof input.password!=='string'||input.password.length>128)throw problem(400,'请输入有效的名称和密码');const user=store.userByName(input.username);const actual=derive(input.password,user?.salt??'missing-user-salt');if(!user||!equal(actual,user.password_hash))throw problem(401,'名称或密码不正确','LOGIN_FAILED');attempts.delete('login');store.audit(user.username,'login',user.id);const previous=tokenFrom(req);if(previous)store.removeSession(previous);return establish(user,res);},
  verifyPassword(current,password){const key='verify:'+current.id;limit(key,12);const user=store.userById(current.id);if(typeof password!=='string'||password.length>128||!user||!equal(derive(password,user.salt),user.password_hash))throw problem(403,'当前密码不正确','PASSWORD_REJECTED');attempts.delete(key);},
  logout(req,res){const token=tokenFrom(req);if(token)store.removeSession(token);res.setHeader('Set-Cookie','content_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return {ok:true};}
 };
}
