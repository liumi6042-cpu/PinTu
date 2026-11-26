import type {Platform,Rect,Route,WebLinks} from '../ports';
import type {GameClient} from '../client';
import type {Stage} from '../ui';
import type {OfflineMode} from '../offline-mode';
import type {PuzzleBoard} from '../puzzle-board';
import type {SocialPanel} from '../social-panel';
import type {RoomClient} from '../../lib/room-client';
import type {CheerEffects} from '../cheer-effects';
import type {CompletionFlow} from '../completion-flow';
import type {CompletionSeat} from '../completion-seats';
import type {RetentionView} from '../retention';
import type {ThemeId} from '../theme';
import {RESTORABLE_PHOTOS} from '../../lib/puzzle-catalog';
import {photoGuidance} from '../../lib/play-guidance';
import collectionCatalog from '../../lib/mobile-collection-catalog.json';
import publicPhrases from '../../config/social-phrases.json';
import type {MobileChapter,MobileLevelClear,MobileLevelsView,MobileOwnedRoom,MobileTaskView} from '../../h5/mobile-api';
import type {CollectionAlbum,CollectionPack,MobileCollectionView} from '../../h5/mobile-collection-api';
import type {RoomCard} from '../../lib/lobby-types';

export type PanelRoom = Omit<RoomClient, 'snapshot'> & {
 snapshot: RoomClient['snapshot'] & {
  levelId?: string;
  maxPlayers?: number;
  mobileResult?: {roomId?: string; levelClear?: MobileLevelClear; ranking?: any; coins?: number; fragments?: number; energy?: number; catalog?: any; doubleClaimed?: boolean; doubleBonus?: {coins: number; fragments: number}};
 };
};

/** Typed host contract bridging GameApp's core state to extracted panel modules. */
export interface AppHost {
 readonly platform: Platform;
 readonly client: GameClient;
 readonly stage: Stage;
 readonly offline: OfflineMode;
 readonly social: SocialPanel;
 readonly completionFlow: CompletionFlow;
 readonly cheerEffects: CheerEffects;
 readonly tasks: MobileTaskView | null;
 readonly collection: MobileCollectionView | null;
 readonly levels: MobileLevelsView | null;
 readonly room: PanelRoom | null;
 readonly board: PuzzleBoard | null;
 readonly rooms: RoomListing[];
 readonly messages: PublicMessage[];
 readonly retention: RetentionView | null;
 readonly historyRooms: MobileOwnedRoom[] | null;
 readonly previewPack: CollectionPack | null;
 readonly selectedChapter: MobileChapter | null;
 readonly storyView: MobileLevelsView | null;
 readonly availableChapters: MobileChapter[];
 readonly dailyPhoto: SharedPhoto | null;
 readonly recentPlayers: RecentPlayer[];
 readonly lobbyRooms: RoomListing[];
 readonly pieceCounts: readonly number[];
 readonly roomTools: ReadonlyArray<readonly [string, string, string]>;
 availableGallery(): SharedPhoto[];
 orderedAlbums(data: MobileCollectionView): CollectionAlbum[];
 chapterForLevel(levelId: string | null | undefined): MobileChapter | null;
 completionSeats(): CompletionSeat[];
 socialRoom(): {id:string;title:string;pieces:number;visibility:string;inviteCode?:string;authorization:string;members:Array<{id:string;name:string;code?:string;level?:number}>} | null;
 // Remaining private GameApp fields/methods accessed incrementally during modularization.
 [key: string]: any;
}

export type Direction='all'|'portrait'|'landscape'|'square';
export type PerformanceMode='smooth'|'power-saving';
export type Modal='orientation'|'weeklyGift'|'welcome'|'members'|'playerCard'|'history'|'filters'|'settings'|'manage'|'invite'|'tools'|'chat'|'social'|'completion'|'levelComic'|'purchase'|'packPreview'|'albums'|'tasks'|'coins'|'fragments'|'privacyRequests'|'redeem'|null;
export type PrivacyRequest={requestId:string;type:'access'|'delete';status:string;createdAt:number;verificationCode:string};
export type RecentPlayer={code:string;name:string;level:number;online:boolean;lastSeenAt:number;roomTitle:string;seenAt:number;requested:boolean};
export type RoomListing=RoomCard&{actualPieces?:number;photo?:SharedPhoto;thumbSrc?:string;members?:{name:string;level:number;decoration?:{id?:string;artKey:string;color:string}|null}[]};
export const directions:[Direction,string][]=[['all','全部'],['portrait','竖图'],['landscape','横图'],['square','方图']];
export const themeOptions:[ThemeId,string][]=[['light','浅色'],['dark','夜间'],['wood','仿木']];
export const counts=[48,108,300,500] as const;
export const contentMaxWidth=1120;
export const settingsTipKey='jigsaw:settings-tip:v1';
export const phrases=publicPhrases;
/** Phrases from this id on are newer than some live servers; show them only once the server lists them. */
export const NEWER_PHRASE_ID=16;
export type PublicMessage={id:number;name:string;text:string;playerId:string;code:string;level?:number;sentAt?:number};
export type SharedPhoto={id:string;title:string;src:string;thumbSrc:string;category:string;width?:number;height?:number};
export type WebPage=Exclude<keyof WebLinks,'legacyLobby'|'legacyRoom'|'largePuzzles'>;
export type ListView={route:Route;scroll:number;albumListScroll:number;direction:Direction;filterCount:number;openOnly:boolean;activeOnly:boolean;category:string;search:string;source:'free'|'owned'|'all';unplayedOnly:boolean;packId:string|null;selected:string|null;collectionTab:'albums'|'packs'|'decorations';albumId:string;decorationId:string;decorationOwnedOnly:boolean;taskTab:'tasks'|'gifts'};
export const photoMap=new Map<string,SharedPhoto>(RESTORABLE_PHOTOS.map(photo=>[photo.id,photo]));
export const packed=new Set(collectionCatalog.packs.flatMap(pack=>pack.imageIds));
export function orientation(id:string):Direction{const photo=photoMap.get(id),size=photo?.width&&photo.height?photo:photoGuidance(id);return !size?'all':size.width===size.height?'square':size.width!>size.height!?'landscape':'portrait';}
export function errorText(error:unknown){return error instanceof Error?error.message:'连接暂时中断，请重试';}
export function taskCoinsText(min=0,max=min){return max>0?' · 金币 +'+min+(min===max?'':'～'+max):'';}
export function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value));}
// 服务端把已完成房间标题改成「已完成」，作品页要显示图片原名。
export function historyPhotoTitle(room:MobileOwnedRoom){return room.photo?.title||(room.imageId?photoMap.get(room.imageId)?.title:undefined)||'拼好的作品';}
export function beijingMonthDay(time:number){const day=new Date(time+8*3600000);return (day.getUTCMonth()+1)+'月'+day.getUTCDate()+'日';}
// Seats come from the server (4/6/8 by piece count); backends without maxPlayers seat 8.
export const seatLimit=(room:{maxPlayers?:number}|null|undefined)=>room?.maxPlayers??8;
export const VIEW_LOCK_KEY='jigsaw:room-view-lock:v1',LOCK_BUTTON_KEY='jigsaw:room-lock-button:v1',MINIMAP_KEY='jigsaw:room-minimap:v1';
export const SHARE_ENERGY_DONE_TEXT='今天已经分享领过体力包了，每天限 1 次，晚上 8 点后可以再领';
export const WECHAT_PACKAGE_VERSION='0.53.20';
export const CHAT_BUBBLE_ARM_MS=600;
export const ORGANIZE_CONFIRM_MS=3000;
export function inside(r:Rect,x:number,y:number){return x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;}
export function roomListKey(rooms:RoomListing[]){return JSON.stringify(rooms.map(room=>[room.id,room.title,room.imageId,room.thumbSrc??room.photo?.thumbSrc??photoMap.get(room.imageId)?.thumbSrc,room.actualPieces??room.pieces,room.placed,room.players,seatLimit(room),room.acceptingNew!==false,!!room.completed]));}
export function messageListKey(messages:PublicMessage[]){return JSON.stringify(messages.map(item=>[item.id,item.name,item.text,item.playerId,item.code,item.level??0,item.sentAt??0]));}
