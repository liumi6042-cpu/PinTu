import {localDb} from './local-db';
import {cosmeticsOf} from '../public/cosmetics/catalog.mjs';
// Indexed account lookup only; no changes to room state or movement cadence.
export async function equippedCosmetics(accountId?:string){
 if(!accountId)return {bubble:null,cursor:null};
 const row=await localDb().prepare("SELECT c.data FROM puzzle_courtyards c LEFT JOIN puzzle_account_security s ON s.user_id=c.user_id WHERE c.user_id=? AND COALESCE(s.status,'active')='active'").bind(accountId).first<{data:string}>();
 return row?cosmeticsOf(JSON.parse(row.data)).equipped:{bubble:null,cursor:null};
}
