import {createHash} from 'node:crypto';

/** Soft nicknames for new Web guests; platform accounts keep their own nickname. */
export const GUEST_NAMES=Object.freeze([
 '橘子汽水','云朵朵','蜜桃乌龙','小满','夏夜','柠檬糖','栗子','奶油泡芙','晚风','青梅',
 '小雏菊','棉花糖','星星灯','芋圆','月亮船','薄荷','豆沙包','桂花糕','小鹿','海盐',
 '春日','荔枝','麦芽糖','布丁','雪梨','向日葵','蒲公英','小橙子','果冻','白桃',
 '可可','抹茶','杏仁','米粒','小熊软糖','葡萄柚','南瓜派','柚子茶','花卷','咕噜',
 '团子','栀子','山茶','银杏','小狐狸','松果','小汤圆','青柠','樱桃','椰奶',
 '草莓酱','焦糖','奶茶','麻薯','软糖','甜筒','饭团','雪糕','蛋挞','红豆',
 '番茄','小葵','初夏','立秋','霜降','谷雨','小雪','清和','微风','细雨',
 '暖阳','晴天','彩虹','流云','萤火','落叶','山间','溪水','木棉','铃兰',
 '风铃','纸飞机','小书签','毛线团','拼拼','小方块','角落','窗台','小茶杯','暖灯',
 '小花园','慢慢','好梦','咕咕','喵呜','软软','圆圆','乖乖','小满月','星河',
]);

function digest(identity,salt){return createHash('sha256').update(salt+':'+identity).digest();}

/** A stable name for this identity; two digits are added when the plain name is already used. */
export function guestName(identity,taken){
 const base=GUEST_NAMES[digest(identity,'name').readUInt32BE(0)%GUEST_NAMES.length];
 if(!taken(base))return base;
 const seed=digest(identity,'suffix');
 for(let attempt=0;attempt<12;attempt++){const name=base+String(10+(seed.readUInt16BE(attempt*2)%90));if(!taken(name))return name;}
 return base+String(10+(seed.readUInt16BE(24)%90));
}
