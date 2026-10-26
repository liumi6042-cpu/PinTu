import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};
import {DEFAULT_GAME_SETTINGS} from './game-settings.mjs';
import {isRetiredDecoration,availableDecorationId} from '../lib/decoration-policy.mjs';

export const MOBILE_COLLECTION_CATALOG=catalog;
const reject=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

/** All mutations share the service's synchronous SQLite IMMEDIATE transaction
 * with puzzle actions and request receipts. The client never selects an owner. */
export function createMobileCollection({db,photos,dailyContent=null,readSettings=()=>DEFAULT_GAME_SETTINGS,readAlbums=()=>null,albumTarget='mobile-shared'}){
 const photoById=new Map(photos.map(photo=>[photo.id,photo]));
 const packById=new Map(catalog.packs.map(pack=>[pack.id,pack]));
 const decorationById=()=>new Map(readSettings().decorations.map(decoration=>[decoration.id,decoration]));
 const packsByImage=new Map();
 for(const pack of catalog.packs)for(const imageId of pack.imageIds){
  if(!photoById.has(imageId))throw new Error('Collection artwork unavailable: '+imageId);
  packsByImage.set(imageId,[...(packsByImage.get(imageId)??[]),pack.id]);
 }
 db.exec(`
 CREATE TABLE IF NOT EXISTS mobile_collection_wallets(owner TEXT PRIMARY KEY,coins INTEGER NOT NULL DEFAULT 0 CHECK(coins>=0),fragments INTEGER NOT NULL DEFAULT 0 CHECK(fragments>=0),equipped TEXT);
 CREATE TABLE IF NOT EXISTS mobile_collection_ledger(owner TEXT NOT NULL,source TEXT NOT NULL,coins INTEGER NOT NULL,fragments INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,source));
 CREATE TABLE IF NOT EXISTS mobile_collection_owned(owner TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,kind,item_id));
 CREATE TABLE IF NOT EXISTS mobile_collection_artworks(owner TEXT NOT NULL,image_id TEXT NOT NULL,pieces INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,image_id,pieces));
 CREATE TABLE IF NOT EXISTS mobile_collection_milestones(owner TEXT NOT NULL,album_id TEXT NOT NULL,target INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,album_id,target));
 CREATE TABLE IF NOT EXISTS mobile_collection_milestone_rewards(owner TEXT NOT NULL,album_id TEXT NOT NULL,milestone_id TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(owner,album_id,milestone_id));
 CREATE TABLE IF NOT EXISTS mobile_collection_completions(room_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
 CREATE TABLE IF NOT EXISTS mobile_collection_legacy_rooms(room_id TEXT PRIMARY KEY);
 `);
 // Preserve completed legacy milestones under stable IDs before thresholds can change.
 for(const row of db.prepare('SELECT owner,album_id,target,created_at FROM mobile_collection_milestones').all()){
  const milestone=catalog.milestones.find(item=>item.target===row.target),album=packById.get(row.album_id);
  const ledger=db.prepare('SELECT coins FROM mobile_collection_ledger WHERE owner=? AND source=?').get(row.owner,'album:'+row.album_id+':'+row.target);
  if(!ledger)continue;
  const reward={target:row.target,coins:ledger.coins,...(milestone?.albumDecoration&&album?{decorationId:album.decorationId}:{})};
  db.prepare('INSERT OR IGNORE INTO mobile_collection_milestone_rewards VALUES(?,?,?,?,?)').run(row.owner,row.album_id,'milestone-'+row.target,JSON.stringify(reward),row.created_at);
 }
 // Installing this system must not turn old finished rooms into new rewards.
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_rooms'").get()){
  db.exec('INSERT OR IGNORE INTO mobile_collection_legacy_rooms SELECT id FROM mobile_rooms WHERE completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mobile_collection_completions WHERE room_id=mobile_rooms.id)');
 }
 function wallet(owner){return db.prepare('SELECT coins,fragments,equipped FROM mobile_collection_wallets WHERE owner=?').get(owner)??{coins:0,fragments:0,equipped:null};}
 function ensureWallet(owner){db.prepare('INSERT OR IGNORE INTO mobile_collection_wallets(owner,equipped) VALUES(?,NULL)').run(owner);}
 function has(owner,kind,itemId){return !!db.prepare('SELECT 1 FROM mobile_collection_owned WHERE owner=? AND kind=? AND item_id=?').get(owner,kind,itemId);}
 function ownsDecoration(owner,decorationId){return !isRetiredDecoration(decorationId)&&decorationById().get(decorationId)?.source==='default'||has(owner,'decoration',decorationId);}
 function equipped(owner){const item=decorationById().get(wallet(owner).equipped);return item&&!isRetiredDecoration(item.id)&&ownsDecoration(owner,item.id)?{...item}:null;}
 function overlay(now){
  return dailyContent?.albumEntries(now,albumTarget)??[];
 }
 const visibleAlbum=album=>albumTarget==='pc'?album.showOnPc:album.showOnMobile;
 function managedAlbums(now){
  const document=readAlbums();if(!document)return null;
  const planned=dailyContent?.managedImageIds(now)??new Set(),released=dailyContent?.releasedImageIds?.(now)??new Set(overlay(now).flatMap(entry=>entry.imageIds));
  const assigned=new Set(document.albums.flatMap(album=>album.imageIds));
  const additions=overlay(now);
  return document.albums.map(album=>({...album,imageIds:[...new Set([...album.imageIds,...additions.filter(entry=>entry.album.id===album.id).flatMap(entry=>entry.imageIds).filter(imageId=>!assigned.has(imageId))])].filter(imageId=>!planned.has(imageId)||released.has(imageId))}));
 }
 function albumImages(albumId,now=Date.now()){
  const managed=managedAlbums(now),album=managed?managed.find(album=>album.id===albumId):packById.get(albumId);
  return album?{imageIds:[...album.imageIds],coverImageId:album.coverImageId??null}:null;
 }
 function packImages(pack,now){return [...new Set([...pack.imageIds,...overlay(now).filter(entry=>entry.album.id===pack.id).flatMap(entry=>entry.imageIds)])];}
 function summary(owner,now=Date.now()){
  const w=wallet(owner),ownedPackIds=db.prepare("SELECT item_id FROM mobile_collection_owned WHERE owner=? AND kind='pack' ORDER BY created_at,item_id").all(owner).map(row=>row.item_id);
  const managed=managedAlbums(now),byId=managed?new Map(managed.map(album=>[album.id,album])):null;
  const currentImages=ownedPackIds.flatMap(id=>byId?byId.get(id)?.imageIds??[]:packById.has(id)?packImages(packById.get(id),now):[]);
  const promisedImages=managed?ownedPackIds.flatMap(id=>packById.get(id)?.imageIds??[]):[];
  const purchasedImages=db.prepare("SELECT item_id FROM mobile_collection_owned WHERE owner=? AND kind='image' ORDER BY created_at,item_id").all(owner).map(row=>row.item_id);
  return {coins:w.coins,fragments:w.fragments,ownedPackIds,ownedImageIds:[...new Set([...currentImages,...promisedImages,...purchasedImages])],equipped:equipped(owner)};
 }
 function change(owner,source,coins,fragments,now){
  if(!Number.isSafeInteger(coins)||!Number.isSafeInteger(fragments))throw new TypeError('Invalid collection amount');
  ensureWallet(owner);
  const recorded=db.prepare('SELECT coins,fragments FROM mobile_collection_ledger WHERE owner=? AND source=?').get(owner,source);
  if(recorded){if(recorded.coins!==coins||recorded.fragments!==fragments)throw new Error('Collection receipt conflict');return false;}
  const current=wallet(owner);
  if(current.coins+coins<0)reject(409,'COINS_INSUFFICIENT','金币不足，继续拼图即可积累');
  if(current.fragments+fragments<0)reject(409,'FRAGMENTS_INSUFFICIENT','装饰碎片不足，完成拼图后可以获得');
  db.prepare('INSERT INTO mobile_collection_ledger VALUES(?,?,?,?,?)').run(owner,source,coins,fragments,now);
  db.prepare('UPDATE mobile_collection_wallets SET coins=coins+?,fragments=fragments+? WHERE owner=?').run(coins,fragments,owner);
  return true;
 }
 // Task grants use the same wallet, ledger and transaction as all collection rewards.
 function awardTaskCoins(owner,source,coins,now){
  if(typeof source!=='string'||!source||source.length>512||!Number.isSafeInteger(coins)||coins<0)throw new TypeError('Invalid task coin award');
  const key='task:'+source;
  if(db.prepare('SELECT 1 FROM mobile_collection_ledger WHERE owner=? AND source=?').get(owner,key))return 0;
  return change(owner,key,coins,0,now)?coins:0;
 }
 function imagePacks(imageId,now){const managed=managedAlbums(now);return managed?managed.filter(album=>album.purchasable&&album.imageIds.includes(imageId)).map(album=>album.id):[...new Set([...(packsByImage.get(imageId)??[]),...overlay(now).filter(entry=>(packById.has(entry.album.id)||entry.album.purchasable)&&entry.imageIds.includes(imageId)).map(entry=>entry.album.id)])];}
 function ownsImage(owner,imageId,now=Date.now()){return has(owner,'image',imageId)||imagePacks(imageId,now).some(packId=>has(owner,'pack',packId))||(packsByImage.get(imageId)??[]).some(packId=>has(owner,'pack',packId));}
 const requiresPurchase=album=>album.purchasable&&album.price>0;
 function randomAllowed(owner,imageId,now=Date.now()){const managed=managedAlbums(now);if(managed)return managed.some(album=>visibleAlbum(album)&&album.imageIds.includes(imageId)&&(!requiresPurchase(album)||ownsImage(owner,imageId,now)));return !imagePacks(imageId,now).length||ownsImage(owner,imageId,now);}
 function freeImageIds(now=Date.now()){
  const managed=managedAlbums(now);
  if(managed)return [...new Set(managed.filter(album=>visibleAlbum(album)&&!requiresPurchase(album)).flatMap(album=>album.imageIds))];
  const paid=new Set(packedImageIds(now));return galleryPhotos(now).filter(photo=>!paid.has(photo.id)).map(photo=>photo.id);
 }
 function packedImageIds(now=Date.now()){const managed=managedAlbums(now);if(managed){const free=new Set(managed.filter(album=>visibleAlbum(album)&&!requiresPurchase(album)).flatMap(album=>album.imageIds));return [...new Set(managed.filter(album=>visibleAlbum(album)&&requiresPurchase(album)).flatMap(album=>album.imageIds))].filter(id=>!free.has(id));}return [...new Set([...packsByImage.keys(),...overlay(now).filter(entry=>packById.has(entry.album.id)||entry.album.purchasable).flatMap(entry=>entry.imageIds)])];}
 function galleryPhotos(now=Date.now()){const managed=managedAlbums(now);if(!managed)return dailyContent?.galleryPhotos(now)??photos;const shown=new Set(managed.filter(visibleAlbum).flatMap(album=>album.imageIds));return photos.filter(photo=>shown.has(photo.id));}
 function photoView(photo){return {id:photo.id,title:photo.title,src:photo.src,thumbSrc:photo.thumbSrc};}
 function managedView(owner,now,configured){
  const settings=readSettings(),s=summary(owner,now),collected=new Map();
  for(const entry of db.prepare('SELECT image_id,pieces FROM mobile_collection_artworks WHERE owner=?').all(owner))collected.set(entry.image_id,[...(collected.get(entry.image_id)??[]),entry.pieces]);
  const imageView=imageId=>({...photoView(photoById.get(imageId)),collected:collected.has(imageId),difficulties:(collected.get(imageId)??[]).sort((a,b)=>a-b)});
  const issued=db.prepare('SELECT album_id,milestone_id,data FROM mobile_collection_milestone_rewards WHERE owner=?').all(owner);
  const shown=configured.filter(album=>visibleAlbum(album)&&album.imageIds.length),albums=shown.map(album=>({id:album.id,title:album.title,description:album.description,images:album.imageIds.map(imageView),collected:album.imageIds.filter(id=>collected.has(id)).length,total:album.imageIds.length,milestones:album.milestones.map(m=>{
   const record=issued.find(row=>row.album_id===album.id&&row.milestone_id===m.id),reward=record?JSON.parse(record.data):null,earned=!!reward;
   const decorationId=availableDecorationId(reward?reward.decorationId:m.decorationId);
   return {id:album.id+'-'+m.id,target:reward?.target??m.target,coins:reward?.coins??m.coins,...(decorationId?{decorationId}:{}),earned,claimed:earned,claimable:false};
  })}));
  const packs=shown.filter(album=>requiresPurchase(album)&&album.imageIds.length).map(album=>({...album,owned:s.ownedPackIds.includes(album.id),images:album.imageIds.map(imageView),coverSrc:photoById.get(album.coverImageId&&album.imageIds.includes(album.coverImageId)?album.coverImageId:album.imageIds[0]).thumbSrc}));
  const decorations=settings.decorations.filter(item=>!isRetiredDecoration(item.id)).map(item=>({...item,rewardAlbums:shown.flatMap(album=>album.milestones.filter(m=>m.decorationId===item.id).map(m=>({id:album.id,title:album.title,target:m.target}))),owned:ownsDecoration(owner,item.id),equipped:s.equipped?.id===item.id})).filter(item=>item.enabled!==false||item.owned);
  return {wallet:{coins:s.coins,fragments:s.fragments},albums,packs,decorations,equipped:s.equipped,tuning:settings.collection,serverTime:now};
 }
 function view(owner,now){
  const configured=managedAlbums(now);if(configured)return managedView(owner,now,configured);
  const settings=readSettings(),s=summary(owner,now),entries=db.prepare('SELECT image_id,pieces FROM mobile_collection_artworks WHERE owner=?').all(owner),collected=new Map();
  for(const entry of entries)collected.set(entry.image_id,[...(collected.get(entry.image_id)??[]),entry.pieces]);
  const imageView=imageId=>({...photoView(photoById.get(imageId)),collected:collected.has(imageId),difficulties:(collected.get(imageId)??[]).sort((a,b)=>a-b)});
  const milestones=db.prepare('SELECT album_id,milestone_id,data FROM mobile_collection_milestone_rewards WHERE owner=?').all(owner);
  const additions=overlay(now),managed=dailyContent?.managedImageIds(now)??new Set(),visible=new Set(dailyContent?dailyContent.galleryPhotos(now).map(photo=>photo.id):photos.map(photo=>photo.id));
  const shown=id=>!managed.has(id)||visible.has(id);
  const assigned=new Map(additions.flatMap(entry=>entry.imageIds.map(imageId=>[imageId,entry.album.id])));
  const albums=catalog.packs.map(pack=>{const imageIds=packImages(pack,now).filter(id=>!managed.has(id)||assigned.get(id)===pack.id);return {
   id:pack.id,title:pack.title,description:pack.description,images:imageIds.map(imageView),collected:imageIds.filter(id=>collected.has(id)).length,total:imageIds.length,
   milestones:settings.milestones.map(m=>{const record=milestones.find(row=>row.album_id===pack.id&&row.milestone_id===m.id),issued=record?JSON.parse(record.data):null,earned=!!issued,decorationId=availableDecorationId(issued?issued.decorationId:m.albumDecoration?pack.decorationId:null);return {id:pack.id+'-'+m.id,target:issued?.target??m.target,coins:issued?.coins??m.coins,...(decorationId?{decorationId}:{}),earned,claimed:earned,claimable:false};})
  };});
  // Free-gallery works remain collectable, without paid-pack set rewards.
  const basicImages=photos.filter(photo=>photo.status==='published'&&photo.galleryVisible!==false&&!packsByImage.has(photo.id)&&!managed.has(photo.id));
  albums.push({id:'everyday-gallery',title:'日常拾光',description:'在自由图库里遇见的每一幅画，也值得收藏。',images:basicImages.map(photo=>imageView(photo.id)),collected:basicImages.filter(photo=>collected.has(photo.id)).length,total:basicImages.length,milestones:[]});
  for(const {album,imageIds} of additions)if(!packById.has(album.id)){
   const existing=albums.find(item=>item.id===album.id);
   if(existing){existing.images.push(...imageIds.map(imageView));existing.total=existing.images.length;existing.collected=existing.images.filter(image=>image.collected).length;}
   else albums.push({id:album.id,title:album.title,description:album.description,images:imageIds.map(imageView),collected:imageIds.filter(id=>collected.has(id)).length,total:imageIds.length,milestones:[]});
  }
  const packs=catalog.packs.map(pack=>{const imageIds=packImages(pack,now).filter(shown);return {...pack,imageIds,owned:s.ownedPackIds.includes(pack.id),images:imageIds.map(imageView),coverSrc:photoById.get(pack.imageIds[0]).thumbSrc};});
  const decorations=settings.decorations.filter(item=>!isRetiredDecoration(item.id)).map(item=>({...item,owned:ownsDecoration(owner,item.id),equipped:s.equipped?.id===item.id})).filter(item=>item.enabled!==false||item.owned);
  return {wallet:{coins:s.coins,fragments:s.fragments},albums:albums.filter(album=>album.total>0),packs:packs.filter(pack=>pack.imageIds.length),decorations,equipped:s.equipped,tuning:settings.collection,serverTime:now};
 }
 function buy(owner,packId,now){
  const managed=managedAlbums(now),pack=managed?managed.find(album=>album.id===packId&&album.purchasable&&visibleAlbum(album)&&album.imageIds.length):packById.get(packId);if(!pack)reject(400,'INVALID_PACK','图包不存在');
  if(has(owner,'pack',packId))return {alreadyOwned:true};
  change(owner,'buy:'+packId,-pack.price,0,now);
  db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'pack',packId,now);
  const imageIds=managed?[...pack.imageIds]:packImages(pack,now);
  // Permanent image rights survive later changes to an album's members.
  for(const imageId of imageIds)db.prepare('INSERT OR IGNORE INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'image',imageId,now);
  return {alreadyOwned:false,imageIds};
 }
 function craft(owner,decorationId,now){
  const item=decorationById().get(decorationId);if(!item)reject(400,'INVALID_DECORATION','装饰不存在');
  if(isRetiredDecoration(decorationId))reject(409,'DECORATION_RETIRED','这件装饰已移除，正在重新制作');
  if(ownsDecoration(owner,decorationId))return {alreadyOwned:true};
  if(item.enabled===false)reject(409,'DECORATION_DISABLED','这件装饰暂未开放');
  if(item.source!=='craft')reject(409,'ALBUM_REQUIRED','集齐对应图鉴即可获得这件装饰');
  change(owner,'craft:'+decorationId,0,-item.cost,now);
  db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'decoration',decorationId,now);
  return {alreadyOwned:false};
 }
 function equip(owner,decorationId){
  if(decorationId!==null&&!decorationById().has(decorationId))reject(400,'INVALID_DECORATION','装饰不存在');
  if(isRetiredDecoration(decorationId))reject(409,'DECORATION_RETIRED','这件装饰已移除，正在重新制作');
  if(decorationId!==null&&!ownsDecoration(owner,decorationId))reject(403,'DECORATION_NOT_OWNED','请先获得这件装饰');
  ensureWallet(owner);db.prepare('UPDATE mobile_collection_wallets SET equipped=? WHERE owner=?').run(decorationId,owner);
 }
 function contribution(owner,roomId,requestId,now){
  const source='contribution:'+roomId+':'+requestId;if(db.prepare('SELECT 1 FROM mobile_collection_ledger WHERE owner=? AND source=?').get(owner,source))return 0;
  const coins=readSettings().collection.contributionCoins;return change(owner,source,coins,0,now)?coins:0;
 }
 function complete(owner,room,contribution,now){
  const old=db.prepare('SELECT data FROM mobile_collection_completions WHERE room_id=? AND owner=?').get(room.id,owner);if(old)return JSON.parse(old.data);
  if(db.prepare('SELECT 1 FROM mobile_collection_legacy_rooms WHERE room_id=?').get(room.id)||!room.completedAt||!Number.isSafeInteger(contribution)||contribution<=0)return null;
  const settings=readSettings(),tuning=settings.collection;
  const coins=Math.ceil(contribution*tuning.completionCoinRatio),fragments=Math.min(tuning.completionFragmentMaximum,Math.max(tuning.completionFragmentMinimum,Math.floor(contribution/tuning.fragmentContributionStep)));
  change(owner,'completion:'+room.id,coins,fragments,now);
  const imageId=room.puzzle.imageId,pieces=room.mobilePieces,qualifies=contribution>=tuning.catalogMinimumContributions&&photoById.has(imageId),hadImage=!!db.prepare('SELECT 1 FROM mobile_collection_artworks WHERE owner=? AND image_id=?').get(owner,imageId);
  if(qualifies)db.prepare('INSERT OR IGNORE INTO mobile_collection_artworks VALUES(?,?,?,?)').run(owner,imageId,pieces,now);
  const albumRewards=[];
  if(qualifies){
   const collected=new Set(db.prepare('SELECT DISTINCT image_id FROM mobile_collection_artworks WHERE owner=?').all(owner).map(row=>row.image_id));
   const managed=managedAlbums(now);
   for(const album of managed??catalog.packs){
    const imageIds=managed?album.imageIds:packImages(album,now);if(!imageIds.length)continue;
    const count=imageIds.filter(id=>collected.has(id)).length;
    const milestones=managed?album.milestones:settings.milestones.map(m=>({...m,decorationId:m.albumDecoration?album.decorationId:null}));
    for(const m of milestones){
     if(count<m.target)continue;
     const decorationId=availableDecorationId(m.decorationId),reward={target:m.target,coins:m.coins,...(decorationId?{decorationId}:{})};
     const awarded=db.prepare('INSERT OR IGNORE INTO mobile_collection_milestone_rewards VALUES(?,?,?,?,?)').run(owner,album.id,m.id,JSON.stringify(reward),now);if(!awarded.changes)continue;
     db.prepare('INSERT OR IGNORE INTO mobile_collection_milestones VALUES(?,?,?,?)').run(owner,album.id,m.target,now);
     change(owner,'album-milestone:'+album.id+':'+m.id,m.coins,0,now);
     if(decorationId)db.prepare('INSERT OR IGNORE INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'decoration',decorationId,now);
     albumRewards.push({albumId:album.id,title:album.title,target:m.target,coins:m.coins,...(decorationId?{decorationId}: {})});
    }
   }
  }
  const result={coins,fragments,catalog:{imageId,qualified:qualifies,minimumContributions:tuning.catalogMinimumContributions,newlyCollected:qualifies&&!hadImage,difficulty:qualifies?pieces:null,albumRewards}};
  db.prepare('INSERT INTO mobile_collection_completions VALUES(?,?,?,?)').run(room.id,owner,JSON.stringify(result),now);return result;
 }
 function completion(owner,roomId){const row=db.prepare('SELECT data FROM mobile_collection_completions WHERE room_id=? AND owner=?').get(roomId,owner);return row?JSON.parse(row.data):{coins:0,fragments:0,catalog:null};}
 function playerStats(owner,now){
  const albums=view(owner,now).albums;
  return {completedPuzzles:Number(db.prepare('SELECT COUNT(DISTINCT image_id) n FROM mobile_collection_artworks WHERE owner=?').get(owner).n),ownedPacks:summary(owner,now).ownedPackIds.length,completedAlbums:albums.filter(album=>album.total>0&&album.collected===album.total).length};
 }
 return {view,summary,buy,craft,equip,contribution,complete,completion,ownsImage,randomAllowed,freeImageIds,packedImageIds,galleryPhotos,albumImages,equipped,awardTaskCoins,playerStats};
}

