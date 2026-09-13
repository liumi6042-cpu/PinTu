import AccountGate from '@/app/account-gate';
import RoomPlay from '@/app/room-play';
import { readRoom } from '@/lib/room-store';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { roomImagePreload } from '@/lib/room-image-preload';
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const image=await readRoom(id).then(room=>roomImagePreload(room,RESTORABLE_PHOTOS)).catch(()=>null);
 return <>{image&&<link rel="preload" as="image" href={image} fetchPriority="high"/>}<AccountGate><RoomPlay roomId={id}/></AccountGate></>;
}
