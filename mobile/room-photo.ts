import type {RoomSnapshot,RoomPhoto} from '../lib/room-engine';

/** A room owns its artwork. Never insert it into the live gallery's photo map. */
export function activeRoomPhoto(room:Pick<RoomSnapshot,'puzzle'|'artwork'|'photo'>,catalogPhoto?:RoomPhoto):RoomPhoto|undefined{
 const remote=room.photo?.id===room.puzzle.imageId&&room.photo.src?room.photo:undefined;
 const photo=remote??catalogPhoto;
 if(room.artwork&&photo)return {...photo,...room.artwork};
 return photo;
}
