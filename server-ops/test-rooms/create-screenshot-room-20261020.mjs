import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import * as e from '/srv/sites/jigsaw-mobile-v3/current/outputs/mobile/engine.mjs';
import {mobileGridForPhoto} from '/srv/sites/jigsaw-mobile-v3/current/server/mobile-service.mjs';
const env=Object.fromEntries(fs.readFileSync('/etc/webapps/jigsaw-mobile-v3.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const db=new DatabaseSync(env.MOBILE_DB||'/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite');db.exec('PRAGMA busy_timeout=5000');
const allowed=(env.MOBILE_DIAGNOSTIC_ACCOUNT_IDS||'').split(',');const accounts=db.prepare('SELECT canonical_identity,nickname FROM mobile_taptap_accounts').all().filter(x=>allowed.includes(x.canonical_identity));
if(accounts.length!==1||accounts[0].nickname!=='老头')throw Error('Test account mismatch');
const owner=accounts[0].canonical_identity,marker='screenshot-room-20261020-cat-flower';
const existing=db.prepare("SELECT data FROM mobile_rooms WHERE owner=? AND json_extract(data,'$.adminFixture')=?").get(owner,marker);
if(existing){const r=JSON.parse(existing.data);console.log(JSON.stringify({existing:true,id:r.id,title:r.title,placed:e.placedCount(r.puzzle),total:r.puzzle.cols*r.puzzle.rows}));process.exit(0);}
const photo=e.RESTORABLE_PHOTOS.find(p=>p.id==='cat-journey-flower-shop-v1');const artwork=e.currentRoomArtwork(photo,300,false);for(const src of [artwork.src,artwork.thumbSrc])if(!fs.existsSync('/srv/sites/jigsaw-mobile-v3/current/public'+src))throw Error('Artwork missing');
const grid=mobileGridForPhoto({...photo,...artwork},300);if(grid.cols!==17||grid.rows!==17)throw Error('Unexpected grid');
const puzzle=e.createFittedPuzzle(photo.id,17,17);let missing=0;
for(const g of puzzle.groups){const n=g.pieces[0],x=n%17,y=Math.floor(n/17);const hole=(x>=6&&x<=10&&y>=1&&y<=4)||(x>=13&&x<=15&&y>=2&&y<=4)||(x>=2&&x<=6&&y>=11&&y<=15)||(x>=13&&x<=15&&y>=11&&y<=15);if(hole)missing++;else {g.dx=0;g.dy=0;g.locked=true;}}
if(missing!==69||e.placedCount(puzzle)!==220)throw Error('Progress mismatch');
const now=Date.now(),room={id:randomBytes(16).toString('hex'),ownerId:owner,visibility:'private',title:'雨后猫咪花店 · 截图测试',artwork,puzzle,mobilePieces:300,mobileMode:'selected',mobileDay:null,mobileInviteCode:randomBytes(16).toString('hex'),revision:0,createdAt:now,expiresAt:now+30*86400000,completedAt:null,retentionVersion:2,lastPlayedAt:now,members:[],leases:{},startedAt:null,participants:{},adminFixture:marker};
const op='/srv/sites/jigsaw-mobile-v3/shared/operations/'+marker;fs.mkdirSync(op,{recursive:true,mode:0o700});
db.exec('BEGIN IMMEDIATE');try{
 const before=db.prepare('SELECT id,data FROM mobile_rooms WHERE owner=?').all(owner);const profile=db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data;
 fs.writeFileSync(op+'/before.json',JSON.stringify({roomIds:before.map(r=>r.id),profile,newRoom:room},null,2),{mode:0o600,flag:'wx'});
 db.prepare('INSERT INTO mobile_rooms VALUES(?,?,?,?,?,?,?,?)').run(room.id,owner,'private',300,now,null,null,JSON.stringify(room));
 if(db.prepare('SELECT data FROM mobile_profiles WHERE id=?').get(owner).data!==profile)throw Error('Profile changed');
 for(const old of before)if(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(old.id).data!==old.data)throw Error('Existing room changed');
 db.exec('COMMIT');
}catch(err){db.exec('ROLLBACK');throw err;}
const saved=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(room.id).data);const result={id:saved.id,title:saved.title,account:'老头',visibility:saved.visibility,placed:e.placedCount(saved.puzzle),total:289,remaining:69,expiresAt:new Date(saved.expiresAt).toISOString(),oldRoomsPreserved:true,profileUnchanged:true,operation:op};fs.writeFileSync(op+'/result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));db.close();
