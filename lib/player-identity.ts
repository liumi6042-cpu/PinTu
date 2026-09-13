import { currentAccount } from './account-store';
import { randomSecret, tokenHash, SESSION_SECONDS } from './account-crypto';
import { RoomError } from './room-engine';

export type PlayerIdentity = { id:string; name:string; accountId?:string; guestId?:string; cookie?:string };
export function guestSecret(request:Request){return request.headers.get('Cookie')?.match(/(?:^|;\s*)puzzle_guest=([a-f0-9]{64})(?:;|$)/)?.[1]||null;}
export async function currentGuest(request:Request,create=false,candidate?:string):Promise<PlayerIdentity|null>{
  let secret=guestSecret(request),cookie:string|undefined;
  if(!secret&&create){secret=candidate&&/^[a-f0-9]{64}$/.test(candidate)?candidate:randomSecret();cookie='puzzle_guest='+secret+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+SESSION_SECONDS+(new URL(request.url).protocol==='https:'?'; Secure':'');}
  if(!secret)return null;
  const guestId='guest:'+await tokenHash(secret);
  return {id:guestId,guestId,name:'游客 '+guestId.slice(-4).toUpperCase(),cookie};
}
export async function currentPlayer(request:Request,create=false,candidate?:string):Promise<PlayerIdentity|null>{
  const account=await currentAccount(request);
  return account?{id:account.id,name:account.name,accountId:account.id}:currentGuest(request,create,candidate);
}
export async function requirePlayer(request:Request){const player=await currentPlayer(request);if(!player)throw new RoomError('请重新加入房间',401);return player;}
export function withPlayerCookie(response:Response,player:PlayerIdentity){if(player.cookie)response.headers.set('Set-Cookie',player.cookie);return response;}
