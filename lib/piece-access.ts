export const PIECE_LOGIN_REQUIRED='500 片及以上的拼图需要登录，普通账号即可免费游玩。';
export function requiresPieceAccount(pieces:number){return Number.isFinite(pieces)&&pieces>=500;}
