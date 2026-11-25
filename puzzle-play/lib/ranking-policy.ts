const DAY=86400000,OFFSET=8*3600000;
export type RankingPeriod='all'|'week';
export function beijingWeek(now=Date.now()){
  const local=new Date(now+OFFSET),daysSinceMonday=(local.getUTCDay()+6)%7;
  const start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-daysSinceMonday*DAY-OFFSET;
  return {start,end:start+7*DAY};
}
export function recordKind(elapsed:number,previous:number|null){return previous===null?'first':elapsed<previous?'improved':elapsed===previous?'tied':'finished';}
