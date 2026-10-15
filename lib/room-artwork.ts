import registry from '../content/artwork-revisions.json' with {type:'json'};

/** Image identity stays in puzzle.imageId; this is the immutable drawing used by one room. */
export type RoomArtwork={revision:string;src:string;thumbSrc:string;width:number;height:number};
type Photo={id:string;src:string;thumbSrc?:string;optimizedSrc?:string;optimizedStandardSrc?:string;standardSrc?:string;[key:string]:unknown};
type ArtworkRoom={puzzle:{imageId:string;cols?:number;rows?:number};artwork?:RoomArtwork;customImage?:unknown};
const versions=registry.versions as Record<string,RoomArtwork[]>;
const legacy=registry.legacy as Record<string,RoomArtwork>;
const active=registry.active as Record<string,string>;
export const ARTWORK_SNAPSHOT_HEADER='X-Jigsaw-Artwork-Snapshot';
const fields=['revision','src','thumbSrc','width','height'] as const;
const copy=(artwork:RoomArtwork):RoomArtwork=>({...artwork});

export function trustedRoomArtwork(imageId:string,value:unknown):RoomArtwork|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const candidate=value as RoomArtwork;
 const found=versions[imageId]?.find(item=>fields.every(key=>item[key]===candidate[key]));
 return found?copy(found):undefined;
}
export function legacyRoomArtwork(imageId:string){return legacy[imageId]?copy(legacy[imageId]):undefined;}
export function activeRoomArtwork(imageId:string){
 const revision=active[imageId];if(!revision)return undefined;
 const found=versions[imageId]?.find(item=>item.revision===revision);
 if(!found)throw Object.assign(new Error('图片画质升级登记暂不可用，请稍后重试'),{status:503});
 return copy(found);
}
export function supportsArtworkSnapshot(headers:Pick<Headers,'get'>){return headers.get(ARTWORK_SNAPSHOT_HEADER)==='1';}

/** Select from our file inventory, never from a URL or revision supplied by a player. */
export function currentRoomArtwork(photo:Photo,pieces:number,legacyOnly=false):RoomArtwork{
 if(legacyOnly&&legacy[photo.id])return copy(legacy[photo.id]);
 const upgraded=activeRoomArtwork(photo.id);if(upgraded)return upgraded;
 const src=pieces<=1000?photo.optimizedStandardSrc??photo.optimizedSrc??photo.standardSrc??photo.src:photo.optimizedSrc??photo.src;
 const found=versions[photo.id]?.find(item=>item.src===src&&item.thumbSrc===photo.thumbSrc);
 if(!found)throw Object.assign(new Error('图片版本尚未完成交付登记，请稍后重试'),{status:503});
 return copy(found);
}
export function resolveRoomArtwork(room:ArtworkRoom,photos:readonly Photo[]=[]):RoomArtwork|undefined{
 if(room.customImage)return undefined;
 if(room.artwork){
  const artwork=trustedRoomArtwork(room.puzzle.imageId,room.artwork);
  if(!artwork)throw Object.assign(new Error('房间图片版本暂不可用，请稍后重试'),{status:503});
  return artwork;
 }
 if(legacy[room.puzzle.imageId])return copy(legacy[room.puzzle.imageId]);
 const photo=photos.find(item=>item.id===room.puzzle.imageId);
 if(!photo)return undefined;
 return currentRoomArtwork(photo,(room.puzzle.cols??0)*(room.puzzle.rows??0));
}
export function roomUsesUpgradedArtwork(room:ArtworkRoom){
 const original=legacy[room.puzzle.imageId];
 return !!original&&!!room.artwork&&room.artwork.revision!==original.revision;
}
export function checkArtworkClient(room:ArtworkRoom,headers:Pick<Headers,'get'>){
 if(roomUsesUpgradedArtwork(room)&&!supportsArtworkSnapshot(headers))throw Object.assign(new Error('这间拼图使用新版图片，请刷新页面或更新小游戏后重新进入'),{status:409,code:'ARTWORK_CLIENT_UPDATE_REQUIRED'});
}
export function roomArtworkPhoto<T extends Photo>(room:ArtworkRoom,photos:readonly T[]):T|undefined{
 const photo=photos.find(item=>item.id===room.puzzle.imageId);if(!photo)return undefined;
 const artwork=resolveRoomArtwork(room,photos);if(!artwork)return photo;
 // Keep downstream image selectors from overriding the room snapshot with today's catalog URLs.
 return {...photo,...artwork,optimizedSrc:artwork.src,optimizedStandardSrc:artwork.src,standardSrc:artwork.src,playSrc:artwork.src};
}

/** Presentation overlay only: the original catalog and provenance remain unchanged. */
export function activeArtworkPhoto<T extends Photo>(photo:T):T{
 const artwork=activeRoomArtwork(photo.id);if(!artwork)return photo;
 return {...photo,...artwork,optimizedSrc:artwork.src,optimizedStandardSrc:artwork.src,standardSrc:artwork.src,playSrc:artwork.src};
}
