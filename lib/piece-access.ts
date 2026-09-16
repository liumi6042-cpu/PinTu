export const PIECE_LOGIN_REQUIRED='创建 500 片及以上的房间需要登录，普通账号即可免费游玩；加入已有房间游玩不需要登录。';
export function requiresPieceAccount(pieces:number){return Number.isFinite(pieces)&&pieces>=500;}
