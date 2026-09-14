export const BOOKMARK_KEY='jigsaw-nook:bookmark:v1';
const DAY=86_400_000;
export const BOOKMARK_REMINDER_DELAY=30*DAY;
export type BookmarkPreference={visitDays:number;lastDay:number;remindAfter:number;dismissed:boolean};
export const EMPTY_BOOKMARK_PREFERENCE:BookmarkPreference={visitDays:0,lastDay:-1,remindAfter:0,dismissed:false};

export function parseBookmarkPreference(raw:string|null):BookmarkPreference{
 try{
  const data=JSON.parse(raw??'null');
  if(!data||!Number.isInteger(data.visitDays)||data.visitDays<0||data.visitDays>3||!Number.isInteger(data.lastDay)||data.lastDay< -1||!Number.isFinite(data.remindAfter)||data.remindAfter<0||typeof data.dismissed!=='boolean')return {...EMPTY_BOOKMARK_PREFERENCE};
  return {visitDays:data.visitDays,lastDay:data.lastDay,remindAfter:data.remindAfter,dismissed:data.dismissed};
 }catch{return {...EMPTY_BOOKMARK_PREFERENCE};}
}
export function recordBookmarkVisit(state:BookmarkPreference,now:number):BookmarkPreference{
 const day=Math.floor(now/DAY);
 return {...state,visitDays:Math.min(3,state.visitDays+(day>state.lastDay?1:0)),lastDay:Math.max(day,state.lastDay)};
}
export function shouldRemindBookmark(state:BookmarkPreference,now:number){return state.visitDays>=3&&!state.dismissed&&now>=state.remindAfter;}
export function bookmarkPlatform(ua:string,platform:string,touchPoints:number){
 if(/iPhone|iPad|iPod/i.test(ua)||(/Mac/i.test(platform)&&touchPoints>1))return 'ios';
 if(/Android/i.test(ua))return 'android';
 if(/Mac/i.test(platform))return 'mac';
 return 'desktop';
}
