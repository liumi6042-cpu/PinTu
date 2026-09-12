import { localDb } from './local-db';
import { RoomError,type Room } from './room-engine';
import { customPhoto,USER_IMAGE_LIMIT,isCustomImageId,type CustomImage,type UserImage } from './custom-images';

const columns='id,title,width,height,byte_size AS bytes,created_at AS createdAt';
export async function userImages(owner:string):Promise<UserImage[]>{
 const rows=await localDb().prepare('SELECT '+columns+' FROM puzzle_user_images WHERE owner_id=? ORDER BY created_at DESC').bind(owner).all<CustomImage&{bytes:number;createdAt:number}>();
 return rows.results.map(row=>({...row,...customPhoto(row)}));
}
export async function ownedUserImage(owner:string,id:string){
 if(!isCustomImageId(id))throw new RoomError('图片不存在',404);
 const row=await localDb().prepare('SELECT '+columns+' FROM puzzle_user_images WHERE id=? AND owner_id=?').bind(id,owner).first<CustomImage&{bytes:number;createdAt:number}>();
 if(!row)throw new RoomError('图片不存在',404);return {...row,...customPhoto(row)};
}
export async function storeUserImage(owner:string,title:string,image:{bytes:Uint8Array;width:number;height:number},preview:Uint8Array){
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',image.bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join(''),now=Date.now(),db=localDb();
 const old=await db.prepare('SELECT id FROM puzzle_user_images WHERE owner_id=? AND sha256=?').bind(owner,hash).first<{id:string}>();
 if(old)return ownedUserImage(owner,old.id);
 const id='custom-'+crypto.randomUUID().replaceAll('-','');
 const result=await db.prepare(`INSERT OR IGNORE INTO puzzle_user_images(id,owner_id,title,width,height,byte_size,sha256,created_at,data,preview)
 SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM puzzle_users WHERE id=?)
 AND (SELECT COUNT(*) FROM puzzle_user_images WHERE owner_id=?)<?`).bind(id,owner,title,image.width,image.height,image.bytes.byteLength+preview.byteLength,hash,now,image.bytes,preview,owner,owner,USER_IMAGE_LIMIT).run();
 if(result.meta.changes!==1){const duplicate=await db.prepare('SELECT id FROM puzzle_user_images WHERE owner_id=? AND sha256=?').bind(owner,hash).first<{id:string}>();if(duplicate)return ownedUserImage(owner,duplicate.id);throw new RoomError('已保存 10 张图片，请先删除不再使用的图片。',409);}
 return ownedUserImage(owner,id);
}
export async function removeUserImage(owner:string,id:string){
 await ownedUserImage(owner,id);
 const result=await localDb().prepare(`DELETE FROM puzzle_user_images WHERE id=? AND owner_id=? AND NOT EXISTS(SELECT 1 FROM puzzle_room_directory WHERE image_id=? AND expires_at>?)`).bind(id,owner,id,Date.now()).run();
 if(result.meta.changes!==1)throw new RoomError('这张图片仍有保存中的拼图，请等房间过期后再删除。',409);
}
// Called after verifying the requester owns the image or is an admitted room
// participant. Bytes never travel in lobby listings or room sync snapshots.
export async function userImageBytes(id:string,preview:boolean){
 const row=await localDb().prepare(`SELECT ${preview?'preview':'data'} AS bytes FROM puzzle_user_images WHERE id=?`).bind(id).first<{bytes:ArrayBuffer|number[]|Uint8Array}>();
 if(!row)throw new RoomError('图片不存在',404);return new Uint8Array(row.bytes as ArrayBuffer);
}
export async function canReadUserImage(id:string,owners:ReadonlySet<string>,roomId?:string|null){
 if(!isCustomImageId(id)||!owners.size)return false;
 const image=await localDb().prepare('SELECT owner_id AS owner FROM puzzle_user_images WHERE id=?').bind(id).first<{owner:string}>();if(!image)return false;if(owners.has(image.owner))return true;
 if(!roomId||!/^[a-f0-9]{32}$/.test(roomId))return false;
 const row=await localDb().prepare("SELECT r.data FROM puzzle_rooms r LEFT JOIN puzzle_room_moderation m ON m.room_id=r.id WHERE r.id=? AND r.expires_at>? AND COALESCE(m.closed,0)=0").bind(roomId,Date.now()).first<{data:string}>();
 if(!row)return false;const room=JSON.parse(row.data) as Room;
 return room.visibility==='private'&&room.puzzle.imageId===id&&room.customImage?.id===id&&(room.members.some(m=>owners.has(m.accountId||m.guestId||''))||[...owners].some(owner=>room.admitted?.[owner]));
}
