import {hasRoomAdmission,RoomError,type Room} from './room-engine';
import {PIECE_LOGIN_REQUIRED,requiresPieceAccount} from './piece-access';
export function checkPieceCreation(pieces:number,accountId?:string){
 if(requiresPieceAccount(pieces)&&!accountId)throw new RoomError(PIECE_LOGIN_REQUIRED,401);
}
export function checkPieceAdmission(room:Room,accountId?:string,identity?:string){
 // Existing identity-bound admissions and tickets remain valid after a warm
 // rollout. Only a first admission requires an account; never gate move/poll.
 if(requiresPieceAccount(room.puzzle.cols*room.puzzle.rows)&&!accountId&&!hasRoomAdmission(room,identity))throw new RoomError(PIECE_LOGIN_REQUIRED,401);
}
