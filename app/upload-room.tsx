'use client';
import {useRef,useState} from 'react';
import {ImagePlus,Loader2} from 'lucide-react';
import CommunityShell from './community-shell';
import {useLanguage} from './language-switch';
import {apiJson,joinPuzzle} from '@/lib/community-client';
import {saveTicket} from '@/lib/room-client';
import {USER_IMAGE_MAX_BYTES,USER_IMAGE_MAX_SIDE,USER_THUMB_MAX_BYTES} from '@/lib/custom-images';

const PIECES=[108,300,500];

type Prepared={blob:Blob;width:number;height:number;url:string;name:string};

/** Draw the picked file onto a canvas and encode it as WebP under a byte budget. */
async function encode(file:File,maxSide:number,quality:number,maxBytes:number):Promise<{blob:Blob;width:number;height:number}>{
 const bitmap=await new Promise<HTMLImageElement>((done,reject)=>{
  const image=new Image(),url=URL.createObjectURL(file);
  image.onload=()=>{URL.revokeObjectURL(url);done(image);};
  image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('无法读取这张图片，请换一张试试'));};
  image.src=url;
 });
 const scale=Math.min(1,maxSide/Math.max(bitmap.naturalWidth,bitmap.naturalHeight));
 const width=Math.round(bitmap.naturalWidth*scale),height=Math.round(bitmap.naturalHeight*scale);
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d');
 if(!context)throw new Error('浏览器无法处理图片');
 context.drawImage(bitmap,0,0,width,height);
 let current=quality;
 for(let attempt=0;attempt<7;attempt+=1){
  const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/webp',current));
  if(!blob)throw new Error('当前浏览器不支持 WebP 转换，请使用 Chrome 或 Edge');
  if(blob.size<=maxBytes)return {blob,width,height};
  current-=0.1;
 }
 throw new Error('压缩后仍然偏大，请选择尺寸小一些的图片');
}

export default function UploadRoom(){
 const language=useLanguage();
 const zh=language!=='en';
 const input=useRef<HTMLInputElement>(null);
 const [prepared,setPrepared]=useState<{full:Prepared;thumb:Prepared}|null>(null);
 const [title,setTitle]=useState('');
 const [pieces,setPieces]=useState(108);
  const [rights,setRights]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [note,setNote]=useState('');

 const pick=async(file:File|undefined)=>{
  if(!file)return;
  setError('');setNote('');
  if(!file.type.startsWith('image/')){setError(zh?'请选择图片文件':'Please choose an image file');return;}
  setBusy(true);
  try{
   const full=await encode(file,USER_IMAGE_MAX_SIDE,0.86,USER_IMAGE_MAX_BYTES);
   const thumb=await encode(file,480,0.78,USER_THUMB_MAX_BYTES);
   if(Math.min(full.width,full.height)<240)throw new Error(zh?'图片太小，短边至少 240 像素':'The short side must be at least 240px');
   setPrepared({
    full:{...full,url:URL.createObjectURL(full.blob),name:file.name},
    thumb:{...thumb,url:URL.createObjectURL(thumb.blob),name:file.name},
   });
   setTitle(file.name.replace(/\.[^.]+$/,'').slice(0,60));
  }catch(e){setError(e instanceof Error?e.message:'图片处理失败');}
  finally{setBusy(false);}
 };

 const create=async()=>{
  if(!prepared||busy)return;
  if(!rights){setError(zh?'请确认你有权使用这张图片':'Please confirm you have the right to use this picture');return;}
  setBusy(true);setError('');setNote(zh?'正在上传…':'Uploading…');
  try{
   const form=new FormData();
   form.set('title',title.trim()||(zh?'我的图片':'My picture'));
   form.set('rights','yes');
   form.set('image',new File([prepared.full.blob],'image.webp',{type:'image/webp'}));
   form.set('preview',new File([prepared.thumb.blob],'preview.webp',{type:'image/webp'}));
   const response=await fetch('/api/user-images',{method:'POST',body:form});
   const saved=await response.json() as {error?:string;image?:{id:string}};
   if(!response.ok||!saved.image)throw new Error(saved?.error||(zh?'上传失败':'Upload failed'));
   setNote(zh?'正在创建房间…':'Creating the room…');
   const ticket=await apiJson<{room:{id:string}}>('/api/rooms',{imageId:saved.image.id,pieces,visibility:'public'});
   saveTicket(ticket as never);
   window.location.assign('/room/'+ticket.room.id);
  }catch(e){setError(e instanceof Error?e.message:'创建失败');setNote('');}
  finally{setBusy(false);}
 };

 return <CommunityShell active="personal"><main className="community-main upload-page">
  <section className="lobby-heading"><div>
   <p className="section-kicker">PLAY YOUR OWN PICTURE</p>
   <h1>{zh?'用一张图片开一桌':'Start a table with your picture'}</h1>
   <p>{zh?'图片只在你开出的房间有效期内保留，房间结束后不再长期保存。':'Your picture is kept only while the room is alive; it is not stored long term.'}</p>
  </div></section>

  <div className="upload-panel">
   <button type="button" className={'upload-drop'+(prepared?' has-image':'')} disabled={busy} onClick={()=>input.current?.click()}>
    {prepared?<img src={prepared.thumb.url} alt=""/>:<><ImagePlus size={34}/><span>{zh?'选择一张图片':'Choose a picture'}</span><small>{zh?'支持 JPG / PNG / WebP，最大 2MB':'JPG / PNG / WebP, up to 2MB'}</small></>}
   </button>
   <input ref={input} type="file" accept="image/*" hidden onChange={event=>void pick(event.target.files?.[0])}/>

   <label className="upload-field"><span>{zh?'图片名称':'Picture name'}</span>
    <input value={title} maxLength={60} onChange={event=>setTitle(event.target.value)} placeholder={zh?'例如：周末的海边':'e.g. Weekend by the sea'}/>
   </label>

   <div className="upload-field"><span>{zh?'碎片数量':'Pieces'}</span>
    <div className="piece-choice">{PIECES.map(count=>(
     <button key={count} type="button" className={pieces===count?'primary':'secondary'} onClick={()=>setPieces(count)}>{count}</button>
    ))}</div>
   </div>

   <div className="upload-field"><span>{zh?'房间':'Room'}</span>
    <small>{zh?'房间会出现在公开大厅，任何拿到链接的人都可以加入。私人房间请在手机客户端创建。':'The table appears in the public lobby; anyone with the link can join. Private rooms are created in the mobile app.'}</small>
   </div>

   <label className="upload-rights"><input type="checkbox" checked={rights} onChange={event=>setRights(event.target.checked)}/>
    <span>{zh?'我确认自己有权使用这张图片':'I confirm I have the right to use this picture'}</span></label>

   {error&&<p className="form-error" role="alert">{error}</p>}
   {note&&!error&&<p className="muted">{note}</p>}

   <div className="modal-footer">
    <button type="button" className="primary" disabled={!prepared||busy||!rights} onClick={()=>void create()}>
     {busy?<><Loader2 size={16} className="loading-icon"/>{zh?'处理中…':'Working…'}</>:<>{zh?'创建房间':'Create room'}</>}
    </button>
   </div>
  </div>
 </main></CommunityShell>;
}
