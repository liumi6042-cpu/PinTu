// Sandbox-only checks against port 3299 (DB copies). Never point this at 3292.
import {readFileSync} from 'node:fs';
const base='http://127.0.0.1:3299',env=Object.fromEntries(readFileSync(process.argv[2],'utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const origin=(env.H5_ALLOWED_ORIGINS||'').split(',')[0];const out={origin};
async function session(){const r=await fetch(base+'/h5/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});return (await r.json()).token;}
async function api(s,path,{method='GET',body,token}={}){const headers={origin,'x-jigsaw-h5-session':s,'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;
 const r=await fetch(base+'/h5/api'+path,{method,headers,body:body?JSON.stringify(body):undefined});let d;try{d=await r.json();}catch{d=null;}return {status:r.status,data:d};}
const rid=()=>crypto.randomUUID().replaceAll('-','');
const a=await session(),b=await session();
const pa=(await api(a,'/mobile/profile')).data;out.profileA={status:!!pa,create:pa?.supply?.create,starter:pa?.starterSelectionAvailable,first:pa?.firstSelectionAvailable};
// 1. Paid pack image + ticket path -> PACK_LOCKED, no ticket spent
const col=(await api(a,'/mobile/collection')).data;const paid=(col?.packs??[]).find(p=>(p.price??0)>0&&!p.owned&&p.imageIds?.length);
const lockedImage=paid?.imageIds?.[0];out.paidAlbum=paid?.id;out.lockedImage=lockedImage;
if(lockedImage){const r=await api(a,'/rooms',{method:'POST',body:{mode:'selected',imageId:lockedImage,pieces:108,visibility:'public',requestId:rid()}});out.packLock={status:r.status,code:r.data?.code};
 const after=(await api(a,'/mobile/profile')).data;out.ticketUnchanged=after?.supply?.create===pa?.supply?.create&&after?.starterSelectionAvailable===pa?.starterSelectionAvailable&&after?.firstSelectionAvailable===pa?.firstSelectionAvailable;}
// 2. Multiplayer room: B joins, A organize -> 403
const made=await api(a,'/rooms',{method:'POST',body:{mode:'random',pieces:108,visibility:'public',requestId:rid()}});out.create=made.status;
const id=made.data?.room?.id,ta=made.data?.token;
const joined=await api(b,'/rooms/'+id+'/join',{method:'POST',body:{}});out.join=joined.status;
const shuffle=await api(a,'/rooms/'+id,{method:'POST',token:ta,body:{type:'shuffle'}});out.organize={status:shuffle.status,error:shuffle.data?.error};
// 3. Player card for B from A, with room
const members=joined.data?.room?.members??[];const bCode=(await api(b,'/mobile/profile')).data?.code??members.find(m=>m.id===joined.data?.playerId)?.code;
const card=await api(a,'/mobile/players/'+bCode+'/card?room='+id);out.card={status:card.status,relationship:card.data?.relationship,stats:card.data?.stats,name:card.data?.player?.name};
const self=await api(a,'/mobile/players/'+pa?.code+'/card');out.selfCard={status:self.status,relationship:self.data?.relationship};
out.lobby=(await api(a,'/lobby?limit=3')).status;out.tasks=(await api(a,'/mobile/tasks')).status;out.gallery=(await api(a,'/mobile/gallery')).status;
console.log(JSON.stringify(out,null,1));
