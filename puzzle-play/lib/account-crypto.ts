import { RoomError, validName } from './room-engine';
export type Account={id:string;username:string;name:string};
export const SESSION_SECONDS=30*24*60*60;
export function usernameOf(value:unknown){if(typeof value!=='string'||!/^[a-zA-Z0-9_]{3,24}$/.test(value.trim()))throw new RoomError('账号需为 3–24 位英文字母、数字或下划线');return value.trim().toLowerCase();}
export function registration(input:Record<string,unknown>){const username=usernameOf(input.username),name=validName(input.name);if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)throw new RoomError('密码需为 8–128 个字符');return {username,name,password:input.password};}
export const hex=(bytes:Uint8Array)=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
export const randomSecret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export async function tokenHash(value:string){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
export async function passwordHash(password:string,salt:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)));}
export function equalHash(a:string,b:string){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export function sessionToken(request:Request){const match=request.headers.get('Cookie')?.match(/(?:^|;\s*)puzzle_session=([a-f0-9]{64})(?:;|$)/);return match?.[1]||null;}
export function sessionCookie(token:string,request:Request,clear=false){return 'puzzle_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(clear?0:SESSION_SECONDS)+(new URL(request.url).protocol==='https:'?'; Secure':'');}
