import sharedClientBuild from '../app/shared-client-build.json';
import {settings} from './site-settings';

/** Presentation-only DTOs. The existing managed store remains the only wallet. */
type Data=Record<string,any>;
export const SHARED_CAPABILITIES={energy:false,ads:false,albumTarget:'pc',createTickets:false,cheers:true,roomLimit:null,supportedPieces:[108,300,500],social:{friends:true,search:true,privateMessages:false,reports:false,blocking:false,remove:true,ignore:true,presence:false,codeFormat:'hex12'}} as const;
export const SHARED_COMPAT_URLS={account:'/account',security:'/account/security',membership:'/membership',uploads:'/upload',legacyLobby:'/play',legacyRoom:'/play?room={id}',largePuzzles:'/play',privacy:'/privacy',terms:'/terms',feedback:'/feedback'};
export function sharedRequestAllowed(request:Request){
 const origin=new URL(request.url).origin,source=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
 if(source&&source!==origin||site==='cross-site')return false;
 return request.method==='GET'||request.method==='HEAD'||source===origin||site==='same-origin';
}
export function sharedConfig(origin:string){return {mobileMode:'web-managed-shared',identityMode:'web-cookie',wechatLoginConfigured:false,adRewardEnabled:false,rewardedAdUnitId:'',capabilities:SHARED_CAPABILITIES,compatUrls:SHARED_COMPAT_URLS,webLinks:SHARED_COMPAT_URLS,assetBase:origin,gameBase:origin+'/play',uiBase:sharedClientBuild.uiBase,...(settings().PUZZLE_REALTIME_ENABLED==='1'?{realtime:{version:1}}:{})};}
export function sharedImage(photo:Data,origin:string){return {...photo,src:new URL(photo.src,origin).href,thumbSrc:new URL(photo.thumbSrc??photo.thumbnailSrc??photo.src,origin).href};}
export function sharedProfile(view:Data,player:Data,account:Data|null,rooms:Data[],state:Data={},progress:Data[]=[]){
 const value=view.profile??{},decorations=view.decorations??[],equipped=decorations.find((d:Data)=>d.equipped)??null;
 const purchasedImages=[...(view.albums??[]).filter((a:Data)=>state.ownedAlbums?.[a.id]).flatMap((a:Data)=>a.images??[]),...(view.retainedImages??[])];
 return {account,identityMode:'web-cookie',capabilities:SHARED_CAPABILITIES,compatUrls:SHARED_COMPAT_URLS,name:player.name,code:view.friends?.code??'',level:value.level??0,xp:value.xpIntoLevel??0,totalXp:value.xp??0,xpToNext:value.xpForNextLevel??1,
  energy:0,energyCap:0,supply:{energy:0,create:0},autoSupply:false,adEligible:false,newcomer:rooms.length===0&&Object.keys(state.rooms??{}).length===0&&progress.length===0,firstSelectionAvailable:false,
  collection:{coins:value.coins??0,fragments:value.fragments??0,ownedPackIds:Object.keys(state.ownedAlbums??{}),ownedImageIds:[...new Set([...Object.keys(state.ownedImages??{}).filter(id=>state.ownedImages[id]),...purchasedImages.map((p:Data)=>p.id)])],equipped},
  giftProgress:value.giftProgress??0,giftCount:(view.tasks?.gifts??[]).filter((g:Data)=>!g.claimed&&(g.coins>0||g.xp>0)).length,ownedRooms:rooms,settlement:view.settlement,serverTime:view.serverTime};
}
export function sharedCollection(view:Data,profile:Data,origin:string,tuning:Data){
 const albums=(view.albums??[]).map((album:Data)=>({...album,collected:album.progress,images:album.images.map((p:Data)=>sharedImage(p,origin)),milestones:(album.milestones??[]).map((m:Data)=>({...m,earned:m.claimed,claimable:false}))}));
 if(view.retainedImages?.length)albums.push({id:'shared-retained-rights',title:'已购图片',description:'原相册调整后仍保留的已购图片',collected:view.retainedImages.filter((p:Data)=>p.collected).length,total:view.retainedImages.length,images:view.retainedImages.map((p:Data)=>sharedImage(p,origin)),milestones:[]});
 return {profile,wallet:{coins:view.profile.coins,fragments:view.profile.fragments},albums,packs:albums.filter((a:Data)=>a.purchasable&&a.price>0).map((a:Data)=>({...a,imageIds:a.images.map((p:Data)=>p.id),coverSrc:a.images[0]?.thumbSrc??''})),decorations:view.decorations??[],equipped:profile.collection.equipped,tuning,settlement:view.settlement,serverTime:view.serverTime};
}
export function sharedTasks(view:Data,profile:Data,rewards:Data){
 const source=view.tasks,day=new Date(view.serverTime+8*3600000).toISOString().slice(0,10),gifts=source.gifts??[];
 // A stable original gift ID is the wire kind. Never pick another gift on retry.
 const inventory=gifts.filter((gift:Data)=>!gift.claimed&&(gift.coins>0||gift.xp>0)).map((gift:Data)=>({kind:gift.id,title:gift.title,count:1,energyMin:0,energyMax:0,xp:gift.xp,xpMin:gift.xp,xpMax:gift.xp,coins:gift.coins,coinsMin:gift.coins,coinsMax:gift.coins,claimable:gift.claimable!==false}));
 const tasks=[...source.daily.map((t:Data)=>({...t,group:'cooperation'})),...source.friends.map((t:Data)=>({...t,group:'friend'})),...source.invitations.map((t:Data)=>({...t,group:t.id==='share-invitation'?'sharing':'invitation'}))].map((task:Data)=>({...task,kind:task.id==='share-invitation'?task.id:'daily:'+day+':'+task.id,earned:task.claimed||task.claimable,energy:0}));
 const sharing=source.invitations.find((t:Data)=>t.id==='share-invitation'),invited=source.invitations.find((t:Data)=>t.id==='invite-friend');
 return {profile,day,giftProgress:profile.giftProgress,giftMinimum:0,giftMaximum:0,giftXp:rewards.tenGrid.xp,giftCoins:rewards.tenGrid.coins??0,giftCount:inventory.length,tasks:[...(source.beginner??[]),...tasks],inventory,
  invitation:{...source.invitation,boundToName:null,todayRewarded:invited?.progress??0,shareDailyLimit:rewards.invitationShare.dailyLimit,todayShared:sharing?.progress??0},settlement:view.settlement,serverTime:view.serverTime};
}
export function sharedGiftId(input:Data,view:Data){
 if(input.quantity!==undefined&&input.quantity!==1)throw Object.assign(Error('每次开启一份已保存的礼包'),{status:400});
 if(typeof input.kind!=='string'||input.kind.length>160)throw Object.assign(Error('礼包编号无效'),{status:400});
 const gift=(view.tasks?.gifts??[]).find((g:Data)=>g.id===input.kind);
 if(!gift)throw Object.assign(Error('礼包不存在或不属于当前玩家'),{status:404});
 return gift;
}
