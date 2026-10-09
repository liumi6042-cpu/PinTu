import type { Room } from './room-engine';
function freeze(value:unknown):void{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}}
// An optimization only: every caller still validates revision and expiry against SQLite.
// Frozen snapshots are shared for reads; mutations must clone before changing any state.
export class RoomReadCache{
  private entries=new Map<string,{room:Room;bytes:number}>();
  private bytes=0;
  maxRooms:number;maxBytes:number;
  constructor(maxRooms=8,maxBytes=2*1024*1024){this.maxRooms=maxRooms;this.maxBytes=maxBytes;}
  get(id:string){const entry=this.entries.get(id);if(entry){this.entries.delete(id);this.entries.set(id,entry);}return entry?.room;}
  put(room:Room,bytes:number){this.remove(room.id);if(bytes>this.maxBytes)return room;freeze(room);this.entries.set(room.id,{room,bytes});this.bytes+=bytes;while(this.entries.size>this.maxRooms||this.bytes>this.maxBytes)this.remove(this.entries.keys().next().value!);return room;}
  remove(id:string){const entry=this.entries.get(id);if(entry)this.bytes-=entry.bytes;this.entries.delete(id);}
}
