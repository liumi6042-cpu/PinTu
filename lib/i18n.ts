import english from '../content/locales/en.json' with { type:'json' };
import { LANGUAGE_KEY, languagePreference, type LanguagePreference } from './language-detection';

export type Language='zh'|'en';
let language:Language='en';
let preference:LanguagePreference='auto';
let preferenceRevision=0;
const listeners=new Set<()=>void>();
export const getLanguage=()=>language;
export const getLanguagePreference=()=>preference;
export const getLanguageRevision=()=>preferenceRevision;
export const subscribeLanguage=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function applyLanguage(value:Language){
  if(typeof document!=='undefined'){document.documentElement.lang=value==='en'?'en':'zh-CN';}
  language=value;
}
export function setLanguagePreference(value:LanguagePreference,persist=true){
  if(persist&&typeof localStorage!=='undefined')try{localStorage.setItem(LANGUAGE_KEY,value);}catch{}
  const changed=preference!==value||(value!=='auto'&&language!==value);
  preference=value;if(changed)preferenceRevision++;
  if(value!=='auto')applyLanguage(value);
  if(changed)for(const listener of listeners)listener();
}
export function restoreLanguagePreference(){
  let saved:string|null=null;
  try{saved=localStorage.getItem(LANGUAGE_KEY);}catch{}
  setLanguagePreference(languagePreference(saved),false);
}
export function setLanguage(value:Language){setLanguagePreference(value);}
export function applyDetectedLanguage(value:Language,revision:number){
  if(preference!=='auto'||revision!==preferenceRevision)return;
  const changed=language!==value;applyLanguage(value);
  if(changed)for(const listener of listeners)listener();
}
const extras:Record<string,string>={
 '入门':'Starter','休闲':'Relaxed','经典':'Classic','挑战':'Challenge','大幅':'Large','超大幅':'Extra large','推荐':'Recommended',
 '已筛选适合大拼图的高清画面。':'Showing higher-resolution pictures suited to large puzzles.',
 '选好片数，点击喜欢的图片就能开始。':'Choose a piece count, then click a picture to begin.',
 '可选画面':'Available pictures','没有符合当前片数与筛选条件的图片。':'No pictures match this piece count and your filters.',
 '清除搜索和分类':'Clear search and category','改为 300 片，查看更多':'Switch to 300 pieces for more pictures',
 '这张图片暂不支持该片数，请选择较少片数或其他图片。':'This picture does not support that piece count. Choose fewer pieces or another picture.',
 '大于 1000 片的新拼图暂时关闭，已有房间可以继续。':'New puzzles above 1,000 pieces are temporarily paused. Existing rooms can still be played.',
 '聊天':'Chat','房间聊天':'Room chat','未读消息':'Unread messages','和这张桌上的朋友聊聊':'A little conversation, piece by piece',
 '收起聊天':'Close chat','恢复已屏蔽的聊天':'Unblock hidden players','聊天消息':'Chat messages','从一句你好开始吧。':'Start with a little hello.',
 '正在连接聊天…':'Connecting to chat…','屏蔽此玩家的聊天':'Hide this player’s messages','查看新消息':'See new messages','说点什么…':'Say something…',
 '发送中…':'Sending…','发送':'Send','消息未发送，请重试':'Message not sent. Please try again.','消息正在发送':'Your message is being sent.',
 '消息请填写 1–300 个字':'Write a message of 1–300 characters.','发送太快了，请稍等片刻再试':'Please wait a moment before sending again.',
 '聊天暂时未连接，正在重试':'Chat disconnected. Reconnecting…','聊天仅用于多人拼图':'Chat is available in multiplayer rooms.',
 '消息游标无效':'Invalid message cursor.','这条消息已发送，请使用新的消息编号':'This message was already sent. Please start a new message.',
 '正在打开拼图…':'Opening your puzzle…',
 '播放队友拼合音效':'Play teammates’ connection sounds',
 '进度保存在当前浏览器':'Progress is saved in this browser',
 '服务器自动保存进度':'Progress is saved automatically',
 '你可以休息一下，房间进度会继续保存。':'Take a break. The room will keep your progress.',
 '每个账号最多保存 10 张图片。图片不加入公开图库；你可以自己拼、开私人房间邀请朋友，也可以开公开房间和其他人一起拼。':'Each account can save up to 10 pictures. They stay out of the public gallery. Play solo, invite friends to a private room, or open a public room.',
 '我有权使用这张图片。我了解：自己拼和私人房间只有我和受邀玩家能看到；如果开公开房间，这张图片会被其他玩家看到，但不会进入公开图库。':'I have the right to use this picture. Solo and private rooms are visible only to me and invited players; a public room lets other players see it, but it will not enter the public gallery.',
 '公开房间会出现在大厅，任何访客都能加入一起拼；这张图片不会进入公开图库。':'The public room appears in the lobby and anyone can join; this picture will not enter the public gallery.',
 '已有成就保留。删除后可在当前页面撤销。':'Existing achievements are kept. You can undo the removal on this page.',
 '图片均为本项目原创生成':'Original artwork generated for this project',
 '服务器保存进度 · 完成后自动记录用时':'Progress saved on this server · Completion time recorded automatically',
 '图库':'Gallery','去图库挑选更多':'Explore the full gallery','把喜欢的画面，慢慢拼起来。':'Find a picture. Make it yours.',
 '所有画面都在这里，选好片数，点图开拼。':'Choose a piece count, then click any picture to play.',
 '8 张精选，点击图片即可开始。':'Eight favorites. Click a picture to start.',
 '108–2,000 片，选好片数，点击图片就能玩。':'108–2,000 pieces. Choose a count, then click a picture.',
 '全部画面':'Pictures','点击图片，开始拼图':'Click a picture to play','开始拼图':'Start puzzle',
 '继续以前的拼图':'Continue an earlier puzzle','历史拼图':'Earlier puzzle',

  '登录（可选）':'Sign in (optional)', '游客游玩':'Playing as a guest',
  '注册为可选操作，游客也可以直接游玩。':'Registration is optional. You can play as a guest.',
  '公开拼图和个人游玩均无需登录。账号入口为后续会员服务保留，当前没有付费项目。':'Public and solo puzzles are free to play without signing in. Accounts are optional; paid membership is not available yet.',
  '无需登录，点开就能一起拼。':'No sign-in needed. Pick a puzzle and join in.',
  '公开拼图大厅':'Public puzzle lobby','点击图片，加入拼图':'Click a picture to join',
  '拼图计时':'Puzzle time','在线人数':'Players online','已满员':'Full',
  '正在游玩':'Playing now','个公开房间':'public rooms',
  // What the lobby shows instead of a live player count: how much the site has finished.
  '幅 · 今天完成':'completed today','幅 · 累计完成':'completed in total',
  '所有拼图':'All puzzles','个人游玩':'Solo play','去创建房间':'Create a room',
  '无需登录 · 最多 8 人一起拼':'No sign-in · Up to 8 players',
  '按玩家实际参与操作统计。':'Counts players who actually moved pieces.',
  '本地服务器保存进度 · 完成后自动记录用时':'Progress saved on this server · Completion time recorded automatically',
  '玩家身份无效':'Invalid player identity',
  '片':'pieces','人':'players','已完成':'complete',
  '从第一次拿起拼块计时，全部归位时结束。暂停与离线不会暂停榜单计时；合作人数按实际参与拼块操作的玩家计算。每局只记一次成绩。':'Timing starts with the first piece moved and ends when the puzzle is complete. Pausing or going offline does not stop the clock. Team size counts players who moved pieces. Each puzzle records one result.',
};
function englishText(text:string):string{
  const known=extras[text]||(english as Record<string,string>)[text];if(known)return known;
  let match:RegExpMatchArray|null;
  if((match=text.match(/^游客 ([A-F0-9]{4})$/)))return 'Guest '+match[1];
  if((match=text.match(/^([\d,]+) 片 · (.+)$/)))return `${match[1]} pieces · ${englishText(match[2])}`;
  if((match=text.match(/^正在铺开 ([\d,]+) [块片]拼图…$/)))return `Laying out ${match[1]} puzzle pieces…`;
  if((match=text.match(/^(?:已归位|已拼) (\d+) \/ (\d+) 片 · (.+)$/)))return `${match[1]} / ${match[2]} pieces placed · ${match[3]}`;
  if((match=text.match(/^([\d,]+) 片$/)))return `${match[1]} pieces`;
  if((match=text.match(/^(\d+) 人$/)))return `${match[1]} ${match[1]==='1'?'player':'players'}`;
  if((match=text.match(/^(一起)?拼对了！已归位 (\d+) \/ (\d+) 片$/)))return `${match[1]?'Nice teamwork':'Nice fit'}! ${match[2]} / ${match[3]} pieces placed`;
  if((match=text.match(/^已整理 (\d+) 块散片，组合保持完整$/)))return `Arranged ${match[1]} loose pieces. Connected groups stayed together.`;
  if((match=text.match(/^(.+) 正在移动这组拼块$/)))return `${match[1]} is moving this group`;
  if((match=text.match(/^(.+)暂时锁定$/)))return `${englishText(match[1])} is locked for now`;
  if((match=text.match(/^抽到了「(.+)」。选好片数后就能开始。$/)))return `You got “${englishText(match[1])}”. Choose a piece count to begin.`;
  if((match=text.match(/^(.+)完成(?:庆祝|效果)预览$/)))return `${englishText(match[1])} completion preview`;
  if((match=text.match(/^(.+)，向下拉或点击$/)))return `${englishText(match[1])}. Pull down or click`;
  if((match=text.match(/^(.+)拼图桌。/)))return `${englishText(match[1])} puzzle table. Drag pieces to connect. Scroll to zoom; drag empty space to pan. N selects a piece, arrows move it, Shift makes fine adjustments, and Enter snaps it.`;
  return text;
}
// UI boundary only: IDs, stored state and player names keep their original values.
export function t<T>(value:T):T {
  if(language!=='en'||typeof value!=='string')return value;
  const trimmed=value.trim(),translated=englishText(trimmed);
  return (translated===trimmed?value:value.replace(trimmed,translated)) as T;
}
// The English copy of a string, whatever language the visitor reads. A page whose address is
// the English one says everything in English — otherwise a Chinese-reading visitor on /lobby
// got Chinese body copy with an English day's picture and an English resume card mixed in.
export function englishFor<T>(value:T):T {
  if(typeof value!=='string')return value;
  const trimmed=value.trim(),translated=englishText(trimmed);
  return (translated===trimmed?value:value.replace(trimmed,translated)) as T;
}
export function playerName(value:string){return /^游客 [A-F0-9]{4}$/.test(value)?t(value):value;}
