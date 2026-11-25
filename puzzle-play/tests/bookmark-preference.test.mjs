import test from 'node:test';
import assert from 'node:assert/strict';
import {BOOKMARK_REMINDER_DELAY,EMPTY_BOOKMARK_PREFERENCE,parseBookmarkPreference,recordBookmarkVisit,shouldRemindBookmark,bookmarkPlatform} from '../lib/bookmark-preference.ts';
const DAY=86400000,now=20000*DAY;
test('bookmark reminders count separate visit days, not navigation or refresh',()=>{
 let state=recordBookmarkVisit(EMPTY_BOOKMARK_PREFERENCE,now);
 for(let i=0;i<20;i++)state=recordBookmarkVisit(state,now+1000*i);
 assert.equal(state.visitDays,1);assert.equal(shouldRemindBookmark(state,now),false);
 state=recordBookmarkVisit(state,now+DAY);assert.equal(shouldRemindBookmark(state,now+DAY),false);
 state=recordBookmarkVisit(state,now+2*DAY);assert.equal(shouldRemindBookmark(state,now+2*DAY),true);
 assert.equal(recordBookmarkVisit(state,now+3*DAY).visitDays,3);
 assert.deepEqual(recordBookmarkVisit(state,now-DAY),state);
});
test('bookmark cooldown and permanent dismissal persist including before first gallery visit',()=>{
 const quiet={visitDays:3,lastDay:20000,remindAfter:now+BOOKMARK_REMINDER_DELAY,dismissed:false};
 assert.equal(shouldRemindBookmark(quiet,quiet.remindAfter-1),false);
 assert.equal(shouldRemindBookmark(quiet,quiet.remindAfter),true);
 const dismissed=parseBookmarkPreference(JSON.stringify({...EMPTY_BOOKMARK_PREFERENCE,dismissed:true}));
 assert.equal(dismissed.dismissed,true);
 let state=dismissed;for(let i=0;i<5;i++)state=recordBookmarkVisit(state,now+i*DAY);
 assert.equal(shouldRemindBookmark(state,now+400*DAY),false);
 assert.equal(shouldRemindBookmark({...quiet,dismissed:true},now+400*DAY),false);
});
test('unreadable or invalid preferences recover safely',()=>{
 for(const raw of [null,'{','null','[]',JSON.stringify({visitDays:Infinity}),JSON.stringify({...EMPTY_BOOKMARK_PREFERENCE,visitDays:100}),JSON.stringify({...EMPTY_BOOKMARK_PREFERENCE,remindAfter:-1}),JSON.stringify({...EMPTY_BOOKMARK_PREFERENCE,dismissed:'false'})])assert.deepEqual(parseBookmarkPreference(raw),EMPTY_BOOKMARK_PREFERENCE);
 assert.deepEqual(parseBookmarkPreference(JSON.stringify(EMPTY_BOOKMARK_PREFERENCE)),EMPTY_BOOKMARK_PREFERENCE);
});
test('bookmark instructions select mobile menus and the correct desktop modifier',()=>{
 assert.equal(bookmarkPlatform('Mozilla iPhone','iPhone',5),'ios');
 assert.equal(bookmarkPlatform('Mozilla Macintosh','MacIntel',5),'ios');
 assert.equal(bookmarkPlatform('Mozilla Android','Linux arm',5),'android');
 assert.equal(bookmarkPlatform('Mozilla Macintosh','MacIntel',0),'mac');
 assert.equal(bookmarkPlatform('Mozilla Windows','Win32',0),'desktop');
});
