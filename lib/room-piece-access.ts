import {RoomError} from './room-engine';
import {PIECE_LOGIN_REQUIRED,requiresPieceAccount} from './piece-access';
// 500 片及以上的门槛只在创建房间时生效。加入、续玩、重连、拖动与聊天都不再要求登录，
// 因此这里不再提供入座校验；旧的已入座身份与游客票据保持有效。
export function checkPieceCreation(pieces:number,accountId?:string){
 if(requiresPieceAccount(pieces)&&!accountId)throw new RoomError(PIECE_LOGIN_REQUIRED,401);
}
