// 平台编号是 JSON 中的透明值，不套用游戏自己的十六进制 ID 或 URL 字符集。
export function validTapPlatformId(value){
 return typeof value==='string'&&value.length>0&&value.length<=256&&!/[\s\u0000-\u001f\u007f-\u009f]/u.test(value);
}
export function normalizeTapPlatformId(value){
 if(validTapPlatformId(value))return value;
 // 仅兼容可以精确表示的整数；大整数、浮点数和对象不猜测、不截断。
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
}
