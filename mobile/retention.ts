// 七日礼 / 每日拼图连续天数 / 拼完的下一步: pure helpers shared by the app and its tests.
export type WeeklyGiftKind='energy-pack'|'coins'|'create-ticket'|'decoration';
export type WeeklyGiftDay={day:number;kind:WeeklyGiftKind;amount?:number;coins?:number;decorationId?:string;state:'claimed'|'today'|'future'};
export type WeeklyGiftView={days:WeeklyGiftDay[];claimed:number;loginDays:number;available:boolean;done:boolean;tomorrowDay:number|null};
export type StreakAward={day:string;streak:number;coins:number;at:number};
export type DailyStreakView={count:number;todayDone:boolean;day:string;next:{at:number;coins:number;in:number}|null;lastAward:StreakAward|null};
export type RetentionView={weeklyGift:WeeklyGiftView;dailyStreak:DailyStreakView};
export type RetentionSummary={weeklyGiftAvailable:boolean;dailyStreak:{count:number;todayDone:boolean;lastAward:StreakAward|null}};
export type WeeklyGrant={day:number;kind:WeeklyGiftKind;amount:number;coins:number;decorationId?:string;fallback:boolean};

export const WEEKLY_GIFT_KEY='jigsaw:weekly-gift:v1';
export const STREAK_SEEN_KEY='jigsaw:daily-streak-seen:v1';
export const HAIRPIN_ID='grandma-hairpin';

/** Beijing calendar day (UTC+8) of a timestamp. */
export const beijingDay=(ms:number)=>new Date(ms+8*3600000).toISOString().slice(0,10);
export const beijingHour=(ms:number)=>new Date(ms+8*3600000).getUTCHours();

/** Icon and two short lines for one 七日礼 cell. */
export function weeklyCell(day:WeeklyGiftDay):{title:string;icon:string;label:string;extra:string|null}{
 const title='第 '+day.day+' 天';
 if(day.kind==='energy-pack')return {title,icon:'energy',label:'体力包 ×'+(day.amount??1),extra:null};
 if(day.kind==='create-ticket')return {title,icon:'ticket',label:'建房券 ×'+(day.amount??1),extra:null};
 if(day.kind==='coins')return {title,icon:'coin',label:'金币 '+(day.amount??0),extra:null};
 return {title,icon:'hairpin',label:'奶奶的发夹',extra:day.coins?'+'+day.coins+' 金币':null};
}

export function weeklyGrantText(g:WeeklyGrant):string{
 if(g.kind==='decoration')return '领到奶奶的发夹'+(g.coins?'和 '+g.coins+' 金币':'');
 if(g.fallback)return (g.kind==='energy-pack'?'体力包':'建房券')+'满了，改发 '+g.coins+' 金币';
 if(g.kind==='energy-pack')return '领到补满体力包 ×'+g.amount;
 if(g.kind==='create-ticket')return '领到建房券 ×'+g.amount;
 return '领到 '+g.coins+' 金币';
}

/** The modal opens by itself at most once per Beijing day, never for newcomers or without the server feature. */
export function weeklyGiftAutoShow(input:{capable:boolean;view:WeeklyGiftView|null;newcomer:boolean;shownDay:string|null;today:string}):boolean{
 return input.capable&&!!input.view&&input.view.available&&!input.view.done&&!input.newcomer&&input.shownDay!==input.today;
}

export function readShownDay(raw:string|null|undefined):string|null{
 if(!raw)return null;try{const value=JSON.parse(raw);return typeof value?.shownDay==='string'?value.shownDay:null;}catch{return null;}
}

/** Row in the 任务 modal that reopens the gift; null once all seven are taken. */
export function weeklyTaskRow(view:WeeklyGiftView|null):string|null{
 if(!view||view.done)return null;
 if(view.available)return '七日礼 · 今天可领第 '+(view.claimed+1)+' 天';
 return view.tomorrowDay?'七日礼 · 明天领第 '+view.tomorrowDay+' 天':null;
}

export const streakBadge=(count:number)=>count>0?'连续 '+count+' 天':'';
export function streakHint(view:Pick<DailyStreakView,'count'|'todayDone'|'next'>|null):string|null{
 if(!view||view.count<=0)return null;
 if(!view.todayDone)return '今天拼一块就能续上';
 return view.next?'再 '+view.next.in+' 天得 '+view.next.coins+' 金币':null;
}

/** Toast once per award, or once per day when today's first daily merge kept the streak going. */
export function streakToast(summary:RetentionSummary['dailyStreak']|null|undefined,seen:{awardAt:number;day:string|null},today:string):{text:string;seen:{awardAt:number;day:string|null}}|null{
 if(!summary)return null;const award=summary.lastAward;
 if(award&&award.at>seen.awardAt)return {text:'每日拼图连续 '+award.streak+' 天，金币 +'+award.coins,seen:{awardAt:award.at,day:summary.todayDone?today:seen.day}};
 if(summary.todayDone&&summary.count>0&&seen.day!==today)return {text:'每日拼图连续 '+summary.count+' 天',seen:{awardAt:Math.max(seen.awardAt,award?.at??0),day:today}};
 return null;
}
export function readStreakSeen(raw:string|null|undefined):{awardAt:number;day:string|null}{
 try{const value=raw?JSON.parse(raw):null;return {awardAt:Number.isFinite(value?.awardAt)?value.awardAt:0,day:typeof value?.day==='string'?value.day:null};}catch{return {awardAt:0,day:null};}
}

export type CompletionPrimary={kind:'level'|'daily'|'album';label:string};
/** 拼完必有下一步: next story level, else today's daily, else the albums. */
export function completionPrimary(input:{levelLabel:'下一关'|'下一章'|'去大厅'|null;dailyDone:boolean}):CompletionPrimary{
 if(input.levelLabel==='下一关'||input.levelLabel==='下一章')return {kind:'level',label:input.levelLabel};
 if(!input.dailyDone)return {kind:'daily',label:'去拼今日拼图'};
 return {kind:'album',label:'去图集看看'};
}

export function completionFooter(input:{tomorrowDay:number|null|undefined;now:number}):string{
 if(input.tomorrowDay)return '明天还能领第 '+input.tomorrowDay+' 天礼物';
 return (beijingHour(input.now)<20?'今晚':'明晚')+' 8 点换新的每日拼图';
}

/** 「第一章 3/6」 and the next chapter-album reward from the album milestones (3/6, 6/6). */
export function chapterProgress(input:{chapterTitle:string;cleared:number;total:number;milestones:readonly {target:number;coins?:number;earned?:boolean}[]}):{progress:string;reward:string|null}{
 const progress=input.chapterTitle+' '+Math.min(input.cleared,input.total)+'/'+input.total;
 const next=input.milestones.filter(m=>!m.earned&&m.target>input.cleared&&(m.coins??0)>0).sort((a,b)=>a.target-b.target)[0];
 return {progress,reward:next?'再拼 '+(next.target-input.cleared)+' 关领 '+next.coins+' 金币':null};
}

/** One line for the next level's teaser, cut to fit `max` characters. */
export function teaserLine(text:string|null|undefined,max:number):string|null{
 const line=(text??'').replace(/\s+/g,'').trim();if(!line)return null;
 const chars=Array.from(line);return chars.length<=max?line:chars.slice(0,Math.max(1,max-1)).join('')+'…';
}

/** Gentle 1.6 s breathing scale for the primary next-level button; 1 when motion is reduced. */
export function breathScale(t:number,reduced=false):number{return reduced?1:1+.035*(.5-.5*Math.cos(t/1600*2*Math.PI));}
