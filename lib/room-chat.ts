export const CHAT_LIMIT=300, CHAT_HISTORY=100, CHAT_INTERVAL=2000, CHAT_PER_MINUTE=20;
export type ChatMessage={id:number;playerId:string;name:string;color:string;text:string;sentAt:number;bubble?:string|null};
export type ChatFeed={messages:ChatMessage[];cursor:number};
export function chatText(value:unknown):string|null {
 if(typeof value!=='string'||value.length>CHAT_LIMIT*2+100)return null;
 const text=value.normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/\t/g,' ').trim();
 return text&&Array.from(text).length<=CHAT_LIMIT?text:null;
}
export function chatCursor(value:unknown):number|null {
 if(typeof value==='string'&&!/^\d{1,16}$/.test(value))return null;
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:null;
}
export function mergeChat(previous:ChatMessage[],incoming:ChatMessage[]){
 const merged=new Map(previous.map(message=>[message.id,message]));
 for(const message of incoming)merged.set(message.id,message);
 return [...merged.values()].sort((a,b)=>a.id-b.id).slice(-CHAT_HISTORY);
}
