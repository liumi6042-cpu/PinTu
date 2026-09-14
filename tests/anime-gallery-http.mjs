import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
const base=process.argv[2],filename=process.argv[3];
assert.equal(base,'http://127.0.0.1:3137','Run only against the disposable release smoke server');
const catalog=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url),'utf8'));
assert.match(filename??'',/[\\/]jigsaw-release-test-[^\\/]+[\\/]data[\\/]puzzle\.sqlite$/);
const pictures=catalog.filter(photo=>photo.category==='动漫');
assert.equal(pictures.length,5);assert.ok(pictures.every(photo=>photo.status==='archived'));
const headers={Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'};
const get=path=>fetch(base+path,{headers,signal:AbortSignal.timeout(10000)});
const database=new DatabaseSync(resolve(filename));
try{
 const gallery=await (await get('/gallery')).text(),sitemap=await (await get('/sitemap.xml')).text();
 assert.equal((gallery.match(/class="gallery-entry-card"/g)||[]).length,catalog.filter(photo=>photo.status==='published').length);
 for(const photo of pictures){
  assert.ok(!gallery.includes(photo.id));assert.ok(!sitemap.includes(photo.id));
  assert.equal((await get('/puzzle/'+photo.id)).status,404);
  const create=body=>fetch(base+'/api/rooms',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...body,visibility:'public',pieces:108,guestSecret:randomBytes(32).toString('hex')}),signal:AbortSignal.timeout(10000)});
  const rejected=await create({imageId:photo.id});assert.equal(rejected.status,400,photo.id);await rejected.arrayBuffer();
  // Seed an earlier room only in this disposable DB, without a public API bypass.
  const response=await create({imageId:'mountain-lake-reflection-hd-v3'});
  assert.equal(response.status,201);const ticket=await response.json(),cookie=response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const id=ticket.room.id,row=database.prepare('SELECT data FROM puzzle_rooms WHERE id=?').get(id),room=JSON.parse(row.data);
  room.puzzle.imageId=photo.id;room.puzzle.groups[0].locked=true;room.puzzle.groups[0].dx=0;room.puzzle.groups[0].dy=0;room.revision+=1;
  database.exec('BEGIN IMMEDIATE');
  try{
   database.prepare('UPDATE puzzle_rooms SET data=?,revision=? WHERE id=?').run(JSON.stringify(room),room.revision,id);
   database.prepare('UPDATE puzzle_room_directory SET image_id=? WHERE room_id=?').run(photo.id,id);
   database.exec('COMMIT');
  }catch(error){database.exec('ROLLBACK');throw error;}
  const joined=await fetch(base+'/api/rooms/'+id+'/join',{method:'POST',headers:{...headers,Cookie:cookie,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
  assert.equal(joined.status,200);const restored=await joined.json();assert.equal(restored.room.puzzle.imageId,photo.id);assert.deepEqual(restored.room.puzzle.groups,room.puzzle.groups);
  const roomPage=await get('/room/'+id);assert.equal(roomPage.status,200);const html=await roomPage.text();assert.ok(html.split('</head>')[0].includes(photo.optimizedSrc));
  for(const src of [photo.optimizedSrc,photo.playSrc,photo.thumbSrc]){const asset=await get(src);assert.equal(asset.status,200);await asset.arrayBuffer();}
 }
 console.log(JSON.stringify({withdrawnAnime:5,publishedPictures:catalog.filter(photo=>photo.status==='published').length,newCreationRejected:true,galleryAndSitemapExcluded:true,existingRoomJoinAndProgressPreserved:true,legacyAssetsAvailable:true}));
}finally{database.close();}
