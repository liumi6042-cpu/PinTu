import type {RoomCard} from './lobby-types';

type Entry={database:object;cards?:RoomCard[];expiresAt:number;pending?:Promise<RoomCard[]>};

// A single public directory snapshot, never an identity-keyed or room-state cache.
export class PublicLobbyCache {
 private entry:Entry|undefined;
 private now:()=>number;
 constructor(now:()=>number=Date.now){this.now=now;}
 async read(database:object,load:()=>Promise<RoomCard[]>):Promise<RoomCard[]>{
  let entry=this.entry;
  if(!entry||entry.database!==database)this.entry=entry={database,expiresAt:0};
  if(entry.cards&&this.now()<entry.expiresAt)return structuredClone(entry.cards);
  if(!entry.pending){
   const target=entry,startedAt=this.now();
   target.pending=Promise.resolve().then(load).then(cards=>{
    const snapshot=structuredClone(cards.slice(0,24));
    // A slower query from a previous database must not replace the current slot.
    if(this.entry===target){target.cards=snapshot;target.expiresAt=startedAt+1000;}
    return snapshot;
   }).finally(()=>{target.pending=undefined;});
  }
  return structuredClone(await entry.pending!);
 }
}
