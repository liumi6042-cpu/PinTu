import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const base=process.argv[2];
assert.equal(base,'http://127.0.0.1:3137','Run only against the disposable release smoke server');
const catalog=JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json',import.meta.url),'utf8'));
const english=JSON.parse(readFileSync(new URL('../content/locales/en.json',import.meta.url),'utf8'));
const pictures=catalog.filter(p=>p.status==='published'&&p.category==='动漫');
assert.equal(pictures.length,5);
const headers={Host:'jigsawnook.online','X-Forwarded-Host':'jigsawnook.online','X-Forwarded-Proto':'https'};
const get=path=>fetch(base+path,{headers,signal:AbortSignal.timeout(10000)});
for(const [i,photo] of pictures.entries()){
 const page=await get('/puzzle/'+photo.id);assert.equal(page.status,200);
 const html=await page.text();assert.ok(html.includes(english[photo.title]));assert.ok(html.includes(english[photo.subtitle]));
 assert.ok(html.includes('/gallery?mode=public&amp;image='+photo.id)||html.includes('/gallery?mode=public&image='+photo.id));
 const response=await fetch(base+'/api/rooms',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({imageId:photo.id,pieces:i%2?108:1000,visibility:'public',guestSecret:randomBytes(32).toString('hex'),initialState:'seed-v1'}),signal:AbortSignal.timeout(10000)});
 assert.equal(response.status,201,photo.id);const ticket=await response.json(),cookie=response.headers.get('set-cookie')?.split(';')[0];
 assert.ok(cookie);assert.equal(ticket.room.puzzle.imageId,photo.id);assert.equal(ticket.room.puzzle.cols*ticket.room.puzzle.rows,i%2?108:1000);
 const roomPage=await get('/room/'+ticket.room.id),roomHtml=await roomPage.text();assert.equal(roomPage.status,200);
 // Public artwork is preloaded in server HTML and uses the optimized variant.
 assert.ok(roomHtml.split('</head>')[0].includes(photo.optimizedSrc),photo.id);
 const joined=await fetch(base+'/api/rooms/'+ticket.room.id,{headers:{...headers,Cookie:cookie,Authorization:'Bearer '+ticket.token},signal:AbortSignal.timeout(10000)});
 assert.equal(joined.status,200);const snapshot=await joined.json();assert.equal(snapshot.puzzle.groups.length,i%2?108:1000);
 await fetch(base+'/api/rooms/'+ticket.room.id,{method:'POST',headers:{...headers,Cookie:cookie,Authorization:'Bearer '+ticket.token,'Content-Type':'application/json'},body:JSON.stringify({type:'leave'})});
}
console.log(JSON.stringify({animePictures:pictures.length,englishPages:true,newRoomCreation:true,optimizedSSRPreload:true}));
