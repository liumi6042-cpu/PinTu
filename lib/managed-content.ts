import {env} from 'cloudflare:workers';
import {dailyPuzzle} from './daily-puzzle';
import {GALLERY_PHOTOS,RESTORABLE_PHOTOS} from './puzzle-catalog';
import {photoGuidance} from './play-guidance';

export type ManagedPhoto=(typeof RESTORABLE_PHOTOS[number])&{width:number;height:number};
export type ManagedMilestone={id:string;target:number;coins:number;decorationId:string|null};
export type ManagedAlbum={id:string;title:string;description:string;imageIds:string[];coverImageId:string|null;showOnPc:boolean;showOnMobile:boolean;purchasable:boolean;price:number;decorationId:string|null;milestones:ManagedMilestone[]};
export type ManagedAlbumDocument={schema:string;albums:ManagedAlbum[];configDigest?:string};
export type ManagedDecoration={id:string;title:string;description:string;kind:string;artKey:string;color:string;cost:number;source:string;enabled:boolean;albumId?:string};
export type ManagedGameSettings={schema:string;progression:{earlyXp:number[];laterXpStep:number;laterXpMaximum:number};energy:{contributionXp:number;[key:string]:unknown};collection:{contributionCoins:number;completionCoinRatio:number;fragmentContributionStep:number;completionFragmentMinimum:number;completionFragmentMaximum:number;catalogMinimumContributions:number};milestones:{id:string;target:number;coins:number;albumDecoration:boolean}[];decorations:ManagedDecoration[];configDigest?:string};
export type ManagedTaskRewards={schema:string;tasks:{id:string;coins:number;xp:number;energy:number}[];invitationShare:{coins:number;xp:number;dailyLimit:number;energy:number};invitationFriend:{coins:number;xp:number;effect:string};tenGrid:{coins:number;xp:number;energyMin:number;energyMaxByTier:number[]};configDigest?:string};
export type ManagedDailyDocument={schema:string;timezone:string;entries:{date:string;imageId:string;albumId:string}[];automaticCandidates:{imageId:string;albumId:string}[];fallbackImageIds:string[];albums:Omit<ManagedAlbum,'imageIds'|'coverImageId'>[];configDigest:string};
type DailyRuntime={select:(now:number)=>ManagedPhoto;albumEntries:(now:number,target:string)=>{album:ManagedAlbum;imageIds:string[]}[];managedImageIds:(now:number)=>Set<string>;releasedImageIds:(now:number)=>Set<string>};
export type ManagedContentSnapshot={releaseId:string;manifestSha256:string;documents:{albums:ManagedAlbumDocument;daily:ManagedDailyDocument;gameSettings:ManagedGameSettings;taskRewards:ManagedTaskRewards};albums:ManagedAlbumDocument;daily:ManagedDailyDocument;gameSettings:ManagedGameSettings;taskRewards:ManagedTaskRewards;photos:ManagedPhoto[];summary:{albumCount:number;imageCount:number;taskCount:number};configDigests:Record<string,string>;dailyRuntime:DailyRuntime};

/** Node injects the reader through its server-only env module. Worker builds retain legacy content. */
export function readManagedContent():ManagedContentSnapshot|null{
 const bindings=env as unknown as {PUZZLE_CONTENT_SNAPSHOT?:()=>ManagedContentSnapshot|null};
 return typeof bindings.PUZZLE_CONTENT_SNAPSHOT==='function'?bindings.PUZZLE_CONTENT_SNAPSHOT():null;
}

const withManagedDimensions=(photo:typeof RESTORABLE_PHOTOS[number]):ManagedPhoto=>{
 const dimensions=photoGuidance(photo.id);
 if(!Number.isSafeInteger(dimensions?.width)||dimensions.width<=0||!Number.isSafeInteger(dimensions?.height)||dimensions.height<=0)throw Object.assign(new Error('图片暂时不可用，请稍后重试。'),{status:503});
 return {...photo,width:dimensions.width,height:dimensions.height};
};

/** Uses the same persisted appearance and atomic selection algorithm as the mobile service. */
export function managedDailyPuzzle(snapshot:ManagedContentSnapshot|null,now=Date.now()):ManagedPhoto{
 return snapshot?snapshot.dailyRuntime.select(now):withManagedDimensions(dailyPuzzle(now));
}

/** Match mobile collection membership: only actual premieres before today's Beijing midnight join albums. */
export function effectiveManagedAlbums(snapshot:ManagedContentSnapshot,now=Date.now()):ManagedAlbum[]{
 const planned=snapshot.dailyRuntime.managedImageIds(now),released=snapshot.dailyRuntime.releasedImageIds(now);
 const assigned=new Set(snapshot.albums.albums.flatMap(album=>album.imageIds));
 const available=new Set(snapshot.photos.map(photo=>photo.id));
 const additions=snapshot.dailyRuntime.albumEntries(now,'pc');
 return snapshot.albums.albums.filter(album=>album.showOnPc).map(album=>{
  const imageIds=[...new Set([...album.imageIds,...additions.filter(entry=>entry.album.id===album.id).flatMap(entry=>entry.imageIds).filter(imageId=>!assigned.has(imageId))])].filter(imageId=>available.has(imageId)&&(!planned.has(imageId)||released.has(imageId)));
  return {...album,imageIds,coverImageId:album.coverImageId&&imageIds.includes(album.coverImageId)?album.coverImageId:imageIds[0]??null};
 }).filter(album=>album.imageIds.length>0);
}

export function managedGalleryPhotos(snapshot:ManagedContentSnapshot|null,now=Date.now()):ManagedPhoto[]{
 if(!snapshot)return GALLERY_PHOTOS.map(withManagedDimensions);
 const visible=new Set(effectiveManagedAlbums(snapshot,now).flatMap(album=>album.imageIds));
 return snapshot.photos.filter(photo=>visible.has(photo.id)).sort((a,b)=>Date.parse(b.publishedAt??'')-Date.parse(a.publishedAt??''));
}
