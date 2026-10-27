import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({absWorkingDir:root,stdin:{contents:'export {GameApp} from "./mobile/app";',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',target:'es2020'});
const {GameApp}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function levels(cleared=3,status='available'){
 const chapter={id:'ch1',title:'开张',albumId:'beginner',coverImageId:null,coverSrc:null,status,levels:[12,16,20,24,30,35].map((pieces,index)=>({id:'ch1-'+(index+1),imageId:null,title:null,line:null,pieces,status:status==='unavailable'?'unavailable':index<cleared?'cleared':index===cleared?'unlocked':'locked'}))};
 return {seriesTitle:'拾光物语',chapters:[chapter],current:chapter.levels.find(level=>level.status==='unlocked')??null,firstClearEnergy:30};
}
function fixture({width=390,height=844,owner='owner-a',storage=new Map(),data=levels(),newcomer=false}={}){
 const texts=[],glyphs=[],buttons=[],frames=[],images=[],fills=[],strokes=[],hits=[],icons=[],dashes=[],paint=[],saved=[],reads=[],created=[],events=[],ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),globalAlpha:1,filter:'none',setLineDash(value){dashes.push(value);},measureText:value=>({width:String(value).length*6}),save(){saved.push({globalAlpha:this.globalAlpha,fillStyle:this.fillStyle,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,filter:this.filter});},restore(){Object.assign(this,saved.pop());},fillRect(x,y,w,h){const fill={r:{x,y,w,h},color:this.fillStyle,alpha:this.globalAlpha};fills.push(fill);paint.push(fill);},strokeRect(x,y,w,h){strokes.push({r:{x,y,w,h},color:this.strokeStyle});}},{get:(target,key)=>key in target?target[key]:()=>{}});
 const stage={w:width,h:height,ctx,palette:{gold:'#d7ad68',onAccent:'#fffaf0',ink:'#642238',muted:'#a17878',line:'#d4a399',rose:'#c8798c',cream:'#fff9f0',placeholder:'#efdfcc'},text:(value,x,y,size,color,weight)=>{texts.push(String(value));const glyph={value:String(value),x,y,size,color,weight};glyphs.push(glyph);paint.push(glyph);},button:(r,label,fn,opts)=>buttons.push({r,label,fn,opts}),frame:(r,key)=>frames.push({r,key}),image:(src,r)=>{const image={src,r,alpha:ctx.globalAlpha,filter:ctx.filter};images.push(image);paint.push(image);},panel(){},icon:(key,r)=>icons.push({key,r}),meter(){},hit:(r,fn)=>hits.push({r,fn}),retryImages(){},ornaments(){},clip:(_r,fn)=>fn(),measure:value=>String(value).length*6,input(){},invalidate(){}};
 const app=Object.create(GameApp.prototype),client={account:{id:owner},profile:{code:owner,newcomer,ownedRooms:[],level:1,xp:0,xpToNext:20,energy:60,energyCap:60,supply:{energy:0,create:0}},config:{capabilities:{energy:true,ads:false}},asset:value=>value,start:async()=>{events.push('ready');},json:async path=>{reads.push(path);if(path==='/api/levels'){assert.equal(app.ready,true);return data;}if(path==='/api/room-history')return {rooms:[]};throw Error('unexpected '+path);},createRoom:async input=>{created.push(input);return {room:{id:'level-room'}};}};
 const platform={config:{id:width>=1000?'web':'taptap',apiBase:'https://game.test/api'},initialQuery:{},viewport:()=>({width,height,top:0,bottom:0}),storage:{get:key=>storage.get(key)??null,set:(key,value)=>storage.set(key,value)},randomId:()=> 'request',onHide:()=>()=>{},onShow:()=>()=>{}};
 Object.assign(app,{stage,client,platform,navItems:[['lobby'],['gallery'],['collection'],['tasks'],['friends']],privacyAccepted:true,privacyEpoch:0,ready:true,destroyed:false,busy:false,modal:null,route:'lobby',room:null,levels:data,levelsOwner:owner,levelsSerial:0,autoLevelChecked:false,chapterEntryChecked:false,previewReadOnly:false,bodyTop:80,bodyBottom:height-20,scroll:0,extent:0,rooms:[],lobbyPieces:'all',lobbySerial:0,lobbyCursor:null,historyRooms:[],historySerial:0,historyLoading:false,direction:'all',filterCount:0,serverOffset:0,contentOrigin:{x:0,y:0},cleanups:[],timers:[],attempts:new Map(),routeStack:[],routeFrames:[],savedRoutes:new Map(),handledQueries:new Set(),message:'',social:{close(){},refresh:async()=>{},blockedCodes:[]},invalidate:()=>stage.invalidate(),loadLobby:async()=>{events.push('lobby');},loadGallery:async()=>{},loadTasks:async()=>{},attachTicket:async ticket=>{app.route='room';app.room=ticket;}});
 return {app,client,platform,stage,texts,glyphs,buttons,frames,images,fills,strokes,paint,reads,created,storage,events,hits,icons,dashes,clear:()=>{texts.length=glyphs.length=buttons.length=frames.length=images.length=fills.length=strokes.length=paint.length=hits.length=icons.length=dashes.length=0;}};
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function lobby(f){const heroes=[];f.app.drawDailyHero=r=>{heroes.push(r);return r.y+r.h;};f.app.drawRoomHeader=(_x,y)=>y+40;f.app.drawRoomGrid=(_x,y)=>y;f.app.drawRoomSection=(_x,y)=>y;f.app.drawLobby();return heroes;}
async function artwork(f){
 const photos=Array.from({length:6},(_,index)=>({id:'chapter-photo-'+index,title:'图片 '+index,src:'/chapter-'+index+'.webp',thumbSrc:'/chapter-'+index+'-thumb.webp',category:'其他'}));
 f.client.json=async()=>({imageIds:photos.map(photo=>photo.id),packedImageIds:[],photos});delete f.app.loadGallery;await f.app.loadGallery();f.app.levels.chapters[0].levels.forEach((level,index)=>level.imageId=photos[index].id);return photos;
}

export {fixture,levels,tick,lobby,artwork};
