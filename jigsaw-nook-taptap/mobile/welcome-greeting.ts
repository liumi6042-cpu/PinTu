/** 「欢迎回家」 greeting: Beijing time slots, rotating lines, the show-once rule and the one tie-in pill. Pure, so tests can drive the clock. */
export type WelcomeSlotId='dawn'|'morning'|'noon'|'afternoon'|'dusk'|'evening'|'late'|'small';
export type WelcomeSlot={id:WelcomeSlotId;name:string;greeting:string;start:number;end:number;tone:'morning'|'day'|'dusk'|'night'};
export type WelcomeTieIn={kind:'away'|'dailyEnding'|'dailyNew'|'story'|'energy';text:string;icon:string;line?:string};
export type WelcomeRecord={at:number;key:string;line:string;visit:number};

const BEIJING=8*3600000,MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR;
export const WELCOME_GAP=3*HOUR;
export const WELCOME_AWAY=3*DAY;
export const WELCOME_STORAGE_KEY='jigsaw:welcome:v1';
export const WELCOME_ENABLED_KEY='jigsaw:welcome-enabled:v1';
export const WELCOME_AWAY_LINE='好久不见，小窝一直给你留着灯';

// Minutes after Beijing midnight; 深夜 wraps past midnight.
export const WELCOME_SLOTS:readonly WelcomeSlot[]=[
 {id:'dawn',name:'清晨',greeting:'早安',start:300,end:540,tone:'morning'},
 {id:'morning',name:'上午',greeting:'上午好',start:540,end:690,tone:'day'},
 {id:'noon',name:'午间',greeting:'中午好',start:690,end:840,tone:'day'},
 {id:'afternoon',name:'下午',greeting:'下午好',start:840,end:1080,tone:'day'},
 {id:'dusk',name:'傍晚',greeting:'傍晚好',start:1080,end:1200,tone:'dusk'},
 {id:'evening',name:'晚上',greeting:'晚上好',start:1200,end:1380,tone:'night'},
 {id:'late',name:'深夜',greeting:'夜深了',start:1380,end:1560,tone:'night'},
 {id:'small',name:'凌晨',greeting:'还没睡呀',start:120,end:300,tone:'night'},
];
export const WELCOME_LINES:Readonly<Record<WelcomeSlotId,readonly string[]>>={
 dawn:['早起拼一张，今天会顺顺的','窗帘拉开啦，先拼几片醒醒神','今天的每日拼图在等你'],
 morning:['忙里偷闲，轻松一下~','泡杯咖啡，拼两分钟再继续','阳光照进小窝啦，挑张喜欢的图'],
 noon:['吃饱了吗？饭后拼一会儿吧','午休时间到，拼几片放松一下','叫上朋友，一起拼张小的'],
 afternoon:['忙里偷闲，轻松一下~','来杯奶茶，拼一张提提神','奶奶的小店还开着门呢'],
 dusk:['下班啦，把烦恼留在门外','辛苦一天啦，来小窝歇一歇','每日拼图 20 点就换新啦'],
 evening:['一起拼图，消除一天的疲惫吧','小窝的灯亮着，和朋友拼一张','泡杯热茶，一片一片慢慢拼'],
 late:['睡前拼一会儿吧~','今天辛苦了，拼几片再睡','安静的夜，不着急，慢慢拼'],
 small:['睡不着吗？拼几片，困了就睡','猫都睡着了，小声拼一张','拼完这一张，记得早点睡哦'],
};

/** Minutes since Beijing midnight. */
export function beijingMinute(now:number){return Math.floor((((now+BEIJING)%DAY)+DAY)%DAY/MINUTE);}
export function beijingClock(now:number){const m=beijingMinute(now);return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
export function welcomeSlot(now:number):WelcomeSlot{
 const m=beijingMinute(now);
 return WELCOME_SLOTS.find(slot=>m>=slot.start&&m<slot.end||slot.end>1440&&m<slot.end-1440)!;
}
/** One key per slot occurrence: 深夜 after midnight still belongs to the evening it started. */
export function welcomeSlotKey(now:number){
 const slot=welcomeSlot(now),m=beijingMinute(now),since=((m-slot.start)%1440+1440)%1440,start=Math.floor(now/MINUTE)*MINUTE-since*MINUTE,day=new Date(start+BEIJING);
 return slot.id+':'+day.getUTCFullYear()+'-'+(day.getUTCMonth()+1)+'-'+day.getUTCDate();
}
/** 23:00–04:59: no countdowns or stamina nudges. */
export function welcomeQuiet(now:number){const m=beijingMinute(now);return m>=1380||m<300;}

export function readWelcomeRecord(raw:string|null):WelcomeRecord|null{
 try{const value=JSON.parse(raw??'null');if(value&&Number.isFinite(value.at)&&typeof value.key==='string')return {at:value.at,key:value.key,line:typeof value.line==='string'?value.line:'',visit:Number.isFinite(value.visit)?value.visit:value.at};}catch{}
 return null;
}
/** Once per slot occurrence and at least three hours after the last greeting. */
export function welcomeDue(record:WelcomeRecord|null,now:number){
 if(!record)return true;
 if(record.at>now+DAY)return true;
 // v53 and earlier saved the daily clock (4 h ahead): a record from the future only blocks its own slot.
 if(record.at>now+MINUTE)return record.key!==welcomeSlotKey(now);
 return record.key!==welcomeSlotKey(now)&&now-record.at>=WELCOME_GAP;
}
export function pickWelcomeLine(slot:WelcomeSlot,last:string,random:()=>number=Math.random){
 const lines=WELCOME_LINES[slot.id],choices=lines.filter(line=>line!==last);
 return choices[Math.min(choices.length-1,Math.floor(random()*choices.length))]??lines[0];
}

export type WelcomeContext={now:number;lastVisit:number|null;dailyFinished:boolean;story:{title:string;left:number}|null;energyFull:boolean};
/** The first matching tie-in wins; quiet hours never urge. */
export function welcomeTieIn(context:WelcomeContext):WelcomeTieIn|null{
 const {now}=context,m=beijingMinute(now),quiet=welcomeQuiet(now);
 if(context.lastVisit!==null&&now-context.lastVisit>WELCOME_AWAY)return {kind:'away',text:'今日拼图已经备好',icon:'piece',line:WELCOME_AWAY_LINE};
 if(!quiet&&m>=1140&&m<1200&&!context.dailyFinished)return {kind:'dailyEnding',text:'每日拼图还有 '+(1200-m)+' 分钟换新',icon:'piece'};
 if(m>=1200&&m<1320)return {kind:'dailyNew',text:'今晚的每日拼图刚上新',icon:'piece'};
 if(context.story&&context.story.left>0)return {kind:'story',text:'「'+context.story.title+'」还差 '+context.story.left+' 关',icon:'book'};
 if(!quiet&&context.energyFull)return {kind:'energy',text:'体力满满',icon:'lightning'};
 return null;
}

export type WelcomeOwnRoom={id:string;completed?:boolean;unavailable?:boolean};
export type WelcomeOpenRoom={id:string;imageId:string;players:number;maxPlayers?:number;acceptingNew?:boolean;completed:boolean;placed:number;pieces:number;actualPieces?:number};
export type WelcomeStart={kind:'rejoin'|'join';roomId:string}|{kind:'create'};
/** 开拼: back to a table the player already sits at, else the fullest open table on today's daily (under 90 %, like 快速加入), else a new daily table. */
export function welcomeStart(input:{own:readonly WelcomeOwnRoom[];rooms:readonly WelcomeOpenRoom[];dailyImageId:string|null}):WelcomeStart{
 const own=input.own.find(room=>!room.completed&&!room.unavailable);
 if(own)return {kind:'rejoin',roomId:own.id};
 const progress=(room:WelcomeOpenRoom)=>room.placed/Math.max(1,room.actualPieces??room.pieces);
 const daily=input.dailyImageId?input.rooms.filter(room=>room.imageId===input.dailyImageId&&!room.completed&&room.acceptingNew!==false&&room.players<(room.maxPlayers??8)&&progress(room)<.9):[];
 const best=daily.sort((a,b)=>progress(b)-progress(a))[0];
 return best?{kind:'join',roomId:best.id}:{kind:'create'};
}
