import catalog from '../lib/mobile-collection-catalog.json' with {type:'json'};

export const MOBILE_COLLECTION_CATALOG=catalog;
const reject=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

/** All mutations share the service's synchronous SQLite IMMEDIATE transaction
 * with puzzle actions and request receipts. The client never selects an owner. */
export function createMobileCollection({db,photos,dailyContent=null}){
 const photoById=new Map(photos.map(photo=>[photo.id,photo]));
 const packById=new Map(catalog.packs.map(pack=>[pack.id,pack]));
 for(const album of dailyContent?.targetAlbums()??[])if(album.purchasable&&!packById.has(album.id))reject(503,'DAILY_PACK_UNSUPPORTED','每日图片的购买相册尚未接入。');
 const decorationById=new Map(catalog.decorations.map(decoration=>[decoration.id,decoration]));
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
 CREATE TABLE IF NOT EXISTS mobile_collection_completions(room_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,owner));
 CREATE TABLE IF NOT EXISTS mobile_collection_legacy_rooms(room_id TEXT PRIMARY KEY);
 `);
 // Installing this system must not turn old finished rooms into new rewards.
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_rooms'").get()){
  db.exec('INSERT OR IGNORE INTO mobile_collection_legacy_rooms SELECT id FROM mobile_rooms WHERE completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mobile_collection_completions WHERE room_id=mobile_rooms.id)');
 }
 function wallet(owner){return db.prepare('SELECT coins,fragments,equipped FROM mobile_collection_wallets WHERE owner=?').get(owner)??{coins:0,fragments:0,equipped:'berry-spark'};}
 function ensureWallet(owner){db.prepare("INSERT OR IGNORE INTO mobile_collection_wallets(owner,equipped) VALUES(?,'berry-spark')").run(owner);}
 function has(owner,kind,itemId){return !!db.prepare('SELECT 1 FROM mobile_collection_owned WHERE owner=? AND kind=? AND item_id=?').get(owner,kind,itemId);}
 function ownsDecoration(owner,decorationId){return decorationById.get(decorationId)?.source==='default'||has(owner,'decoration',decorationId);}
 function equipped(owner){const item=decorationById.get(wallet(owner).equipped);return item&&ownsDecoration(owner,item.id)?{...item}:null;}
 function overlay(now){
  const entries=dailyContent?.albumEntries(now)??[];
  for(const entry of entries)if(entry.album.purchasable&&!packById.has(entry.album.id))reject(503,'DAILY_PACK_UNSUPPORTED','每日图片的购买相册尚未接入。');
  return entries;
 }
 function packImages(pack,now){return [...new Set([...pack.imageIds,...overlay(now).filter(entry=>entry.album.id===pack.id).flatMap(entry=>entry.imageIds)])];}
 function summary(owner,now=Date.now()){
  const w=wallet(owner),ownedPackIds=db.prepare("SELECT item_id FROM mobile_collection_owned WHERE owner=? AND kind='pack' ORDER BY created_at,item_id").all(owner).map(row=>row.item_id);
  return {coins:w.coins,fragments:w.fragments,ownedPackIds,ownedImageIds:[...new Set(ownedPackIds.flatMap(id=>packById.has(id)?packImages(packById.get(id),now):[]))],equipped:equipped(owner)};
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
 function imagePacks(imageId,now){return [...new Set([...(packsByImage.get(imageId)??[]),...overlay(now).filter(entry=>packById.has(entry.album.id)&&entry.imageIds.includes(imageId)).map(entry=>entry.album.id)])];}
 function ownsImage(owner,imageId,now=Date.now()){return imagePacks(imageId,now).some(packId=>has(owner,'pack',packId));}
 function randomAllowed(owner,imageId,now=Date.now()){return !imagePacks(imageId,now).length||ownsImage(owner,imageId,now);}
 function packedImageIds(now=Date.now()){return [...new Set([...packsByImage.keys(),...overlay(now).filter(entry=>packById.has(entry.album.id)).flatMap(entry=>entry.imageIds)])];}
 function photoView(photo){return {id:photo.id,title:photo.title,src:photo.src,thumbSrc:photo.thumbSrc};}
 function view(owner,now){
  const s=summary(owner,now),entries=db.prepare('SELECT image_id,pieces FROM mobile_collection_artworks WHERE owner=?').all(owner),collected=new Map();
  for(const entry of entries)collected.set(entry.image_id,[...(collected.get(entry.image_id)??[]),entry.pieces]);
  const imageView=imageId=>({...photoView(photoById.get(imageId)),collected:collected.has(imageId),difficulties:(collected.get(imageId)??[]).sort((a,b)=>a-b)});
  const milestones=db.prepare('SELECT album_id,target FROM mobile_collection_milestones WHERE owner=?').all(owner);
  const additions=overlay(now),managed=dailyContent?.managedImageIds(now)??new Set(),visible=new Set(dailyContent?dailyContent.galleryPhotos(now).map(photo=>photo.id):photos.map(photo=>photo.id));
  const shown=id=>!managed.has(id)||visible.has(id);
  const assigned=new Map(additions.flatMap(entry=>entry.imageIds.map(imageId=>[imageId,entry.album.id])));
  const albums=catalog.packs.map(pack=>{const imageIds=packImages(pack,now).filter(id=>!managed.has(id)||assigned.get(id)===pack.id);return {
   id:pack.id,title:pack.title,description:pack.description,images:imageIds.map(imageView),collected:imageIds.filter(id=>collected.has(id)).length,total:imageIds.length,
   milestones:catalog.milestones.map(m=>{const earned=milestones.some(row=>row.album_id===pack.id&&row.target===m.target);return {id:pack.id+'-'+m.target,target:m.target,coins:m.coins,...(m.albumDecoration?{decorationId:pack.decorationId}:{}),earned,claimed:earned,claimable:false};})
  };});
  // Free-gallery works remain collectable, without paid-pack set rewards.
  const basicImages=photos.filter(photo=>photo.galleryVisible!==false&&!packsByImage.has(photo.id)&&!managed.has(photo.id));
  albums.push({id:'everyday-gallery',title:'日常拾光',description:'在自由图库里遇见的每一幅画，也值得收藏。',images:basicImages.map(photo=>imageView(photo.id)),collected:basicImages.filter(photo=>collected.has(photo.id)).length,total:basicImages.length,milestones:[]});
  for(const {album,imageIds} of additions)if(!packById.has(album.id)){
   const existing=albums.find(item=>item.id===album.id);
   if(existing){existing.images.push(...imageIds.map(imageView));existing.total=existing.images.length;existing.collected=existing.images.filter(image=>image.collected).length;}
   else albums.push({id:album.id,title:album.title,description:album.description,images:imageIds.map(imageView),collected:imageIds.filter(id=>collected.has(id)).length,total:imageIds.length,milestones:[]});
  }
  const packs=catalog.packs.map(pack=>{const imageIds=packImages(pack,now).filter(shown);return {...pack,imageIds,owned:s.ownedPackIds.includes(pack.id),images:imageIds.map(imageView),coverSrc:photoById.get(pack.imageIds[0]).thumbSrc};});
  const decorations=catalog.decorations.map(item=>({...item,owned:ownsDecoration(owner,item.id),equipped:s.equipped?.id===item.id}));
  return {wallet:{coins:s.coins,fragments:s.fragments},albums,packs,decorations,equipped:s.equipped,serverTime:now};
 }
 function buy(owner,packId,now){
  const pack=packById.get(packId);if(!pack)reject(400,'INVALID_PACK','图包不存在');
  if(has(owner,'pack',packId))return {alreadyOwned:true};
  change(owner,'buy:'+packId,-pack.price,0,now);
  db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'pack',packId,now);
  return {alreadyOwned:false};
 }
 function craft(owner,decorationId,now){
  const item=decorationById.get(decorationId);if(!item)reject(400,'INVALID_DECORATION','装饰不存在');
  if(ownsDecoration(owner,decorationId))return {alreadyOwned:true};
  if(item.source!=='craft')reject(409,'ALBUM_REQUIRED','集齐对应图鉴即可获得这件装饰');
  change(owner,'craft:'+decorationId,0,-item.cost,now);
  db.prepare('INSERT INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'decoration',decorationId,now);
  return {alreadyOwned:false};
 }
 function equip(owner,decorationId){
  if(decorationId!==null&&!decorationById.has(decorationId))reject(400,'INVALID_DECORATION','装饰不存在');
  if(decorationId!==null&&!ownsDecoration(owner,decorationId))reject(403,'DECORATION_NOT_OWNED','请先获得这件装饰');
  ensureWallet(owner);db.prepare('UPDATE mobile_collection_wallets SET equipped=? WHERE owner=?').run(decorationId,owner);
 }
 function contribution(owner,roomId,requestId,now){
  return change(owner,'contribution:'+roomId+':'+requestId,catalog.tuning.contributionCoins,0,now)?catalog.tuning.contributionCoins:0;
 }
 function complete(owner,room,contribution,now){
  const old=db.prepare('SELECT data FROM mobile_collection_completions WHERE room_id=? AND owner=?').get(room.id,owner);if(old)return JSON.parse(old.data);
  if(db.prepare('SELECT 1 FROM mobile_collection_legacy_rooms WHERE room_id=?').get(room.id)||!room.completedAt||!Number.isSafeInteger(contribution)||contribution<=0)return null;
  const coins=Math.ceil(contribution*catalog.tuning.completionCoinRatio),fragments=Math.min(catalog.tuning.completionFragmentMaximum,Math.max(1,Math.floor(contribution/catalog.tuning.fragmentContributionStep)));
  change(owner,'completion:'+room.id,coins,fragments,now);
  const imageId=room.puzzle.imageId,pieces=room.mobilePieces,qualifies=contribution>=catalog.tuning.catalogMinimumContributions&&photoById.has(imageId),hadImage=!!db.prepare('SELECT 1 FROM mobile_collection_artworks WHERE owner=? AND image_id=?').get(owner,imageId);
  if(qualifies)db.prepare('INSERT OR IGNORE INTO mobile_collection_artworks VALUES(?,?,?,?)').run(owner,imageId,pieces,now);
  const albumRewards=[];
  if(qualifies){
   const collected=new Set(db.prepare('SELECT DISTINCT image_id FROM mobile_collection_artworks WHERE owner=?').all(owner).map(row=>row.image_id));
   for(const album of catalog.packs){
    const count=packImages(album,now).filter(id=>collected.has(id)).length;
    for(const m of catalog.milestones){
     if(count<m.target)continue;
     const awarded=db.prepare('INSERT OR IGNORE INTO mobile_collection_milestones VALUES(?,?,?,?)').run(owner,album.id,m.target,now);if(!awarded.changes)continue;
     change(owner,'album:'+album.id+':'+m.target,m.coins,0,now);
     if(m.albumDecoration)db.prepare('INSERT OR IGNORE INTO mobile_collection_owned VALUES(?,?,?,?)').run(owner,'decoration',album.decorationId,now);
     albumRewards.push({albumId:album.id,title:album.title,target:m.target,coins:m.coins,...(m.albumDecoration?{decorationId:album.decorationId}: {})});
    }
   }
  }
  const result={coins,fragments,catalog:{imageId,qualified:qualifies,newlyCollected:qualifies&&!hadImage,difficulty:qualifies?pieces:null,albumRewards}};
  db.prepare('INSERT INTO mobile_collection_completions VALUES(?,?,?,?)').run(room.id,owner,JSON.stringify(result),now);return result;
 }
 function completion(owner,roomId){const row=db.prepare('SELECT data FROM mobile_collection_completions WHERE room_id=? AND owner=?').get(roomId,owner);return row?JSON.parse(row.data):{coins:0,fragments:0,catalog:null};}
 return {view,summary,buy,craft,equip,contribution,complete,completion,ownsImage,randomAllowed,packedImageIds,equipped};
}

