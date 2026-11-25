import {guestName} from '../server/guest-names.mjs';

// Server-side identity fallback. Keep every explicit account/member nickname.
export function playerName(name:unknown,owner:string){
 const missing=typeof name!=='string'||!name.trim();
 const oldGuestDefault=owner.startsWith('guest:')&&typeof name==='string'&&/^游客(?: [A-F0-9]{4})?$/.test(name);
 return missing||oldGuestDefault?guestName(owner,()=>false):name as string;
}
