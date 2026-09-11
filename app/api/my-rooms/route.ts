import { currentPlayer,currentGuest } from '@/lib/player-identity';
import { roomCards } from '@/lib/lobby-store';
import { body,json,failure } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
import { localDb } from '@/lib/local-db';
import { hiddenPersonalRooms,setPersonalRoomHidden } from '@/lib/personal-room-records';

async function identities(request:Request){
 const player=await currentPlayer(request),guest=await currentGuest(request);
 return [...new Set([player?.id,guest?.id].filter((id):id is string=>!!id))];
}
export async function GET(request:Request){try{
 const owners=await identities(request);
 const [lists,hidden]=await Promise.all([Promise.all(owners.map(id=>roomCards(id))),hiddenPersonalRooms(localDb(),owners)]);
 return json({rooms:[...new Map(lists.flat().map(room=>[room.id,room])).values()].filter(room=>!hidden.has(room.id)).sort((a,b)=>(b.lastPlayedAt||0)-(a.lastPlayedAt||0))});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 const input=await body(request);
 if(typeof input.roomId!=='string'||!['remove','restore'].includes(input.action))throw new RoomError('拼图记录无效',400);
 await setPersonalRoomHidden(localDb(),await identities(request),input.roomId,input.action==='remove');
 return json({ok:true});
}catch(error){return failure(error);}}
