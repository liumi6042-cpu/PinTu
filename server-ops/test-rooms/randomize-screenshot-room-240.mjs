import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {randomInt} from 'node:crypto';import * as e from '/srv/sites/jigsaw-mobile-v3/current/outputs/mobile/engine.mjs';
const db=new DatabaseSync('/srv/sites/jigsaw-mobile-v3/shared/mobile-v3.sqlite');db.exec('PRAGMA busy_timeout=5000');const id='5e5533ce59134fb79ca8a44c34beec14';
db.exec('BEGIN IMMEDIATE');try{
 const row=db.prepare('SELECT * FROM mobile_rooms WHERE id=?').get(id);if(!row||row.closed_at)throw Error('Room unavailable');const r=JSON.parse(row.data);
 if(r.adminFixture!=='screenshot-room-20261020-cat-flower'||r.puzzle.cols!==17||r.puzzle.rows!==17||r.completedAt!==null)throw Error('Unexpected room');
 if(Object.values(r.leases||{}).some(l=>l.expires>Date.now()))throw Error('Currently dragging a piece; retry after released');
 const account=db.prepare('SELECT nickname FROM mobile_taptap_accounts WHERE canonical_identity=?').get(row.owner);if(account?.nickname!=='老头')throw Error('Owner mismatch');
 const missing=new Set(),valid=n=>n>=0&&n<289&&!(n%17>=5&&n%17<=11&&Math.floor(n/17)>=6&&Math.floor(n/17)<=10);
 const choose=arr=>arr[randomInt(arr.length)];const available=()=>Array.from({length:289},(_,i)=>i).filter(n=>valid(n)&&!missing.has(n));
 for(let c=0;c<8;c++){let cluster=[choose(available())];missing.add(cluster[0]);const size=3+randomInt(4);for(let j=1;j<size;j++){const frontier=[...new Set(cluster.flatMap(n=>[n%17>0?n-1:-1,n%17<16?n+1:-1,n-17,n+17]))].filter(n=>valid(n)&&!missing.has(n));if(!frontier.length)break;const n=choose(frontier);cluster.push(n);missing.add(n);}}
 while(missing.size<49)missing.add(choose(available()));if(missing.size!==49)throw Error('Invalid missing count');
 const fresh=e.createFittedPuzzle(r.puzzle.imageId,17,17,r.puzzle.seed);for(const g of fresh.groups)if(!missing.has(g.id)){g.dx=0;g.dy=0;g.locked=true;}
 const op='/srv/sites/jigsaw-mobile-v3/shared/operations/screenshot-room-20261020-cat-flower';const stamp=Date.now();fs.writeFileSync(op+'/before-random240-'+stamp+'.json',row.data,{mode:0o600,flag:'wx'});
 r.puzzle.groups=fresh.groups;r.revision++;r.syncHistory=[];r.leases={};r.lastPlayedAt=stamp;r.adminFixtureLayout='random240';
 if(e.placedCount(r.puzzle)!==240)throw Error('Progress mismatch');const snap=e.roomUpdate(r,stamp,null);if(e.placedCount(snap.puzzle)!==240)throw Error('Snapshot mismatch');
 db.prepare('UPDATE mobile_rooms SET data=? WHERE id=?').run(JSON.stringify(r),id);db.exec('COMMIT');const saved=JSON.parse(db.prepare('SELECT data FROM mobile_rooms WHERE id=?').get(id).data);console.log(JSON.stringify({id,title:saved.title,placed:e.placedCount(saved.puzzle),remaining:49,revision:saved.revision,missing:[...missing].sort((a,b)=>a-b),backup:op+'/before-random240-'+stamp+'.json'}));
}catch(err){db.exec('ROLLBACK');throw err;}finally{db.close();}
