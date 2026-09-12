'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload,ImagePlus,ArrowRight,Trash2,Check,LockKeyhole} from 'lucide-react';
import CommunityShell from '../../community-shell';
import {useAccount} from '../../account-gate';
import {useLanguage} from '../../language-switch';
import {useMembership} from '@/lib/use-membership';
import {t} from '@/lib/i18n';
import {apiJson} from '@/lib/community-client';
import {saveTicket,type RoomTicket} from '@/lib/room-client';
import {prepareUserImage} from '@/lib/user-image-client';
import {USER_IMAGE_LIMIT,type UserImage} from '@/lib/custom-images';
import {LEVELS} from '@/lib/puzzle-engine';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {AlertDialog,AlertDialogContent,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel} from '@/components/ui/alert-dialog';
import './user-images.css';
type Prepared=Awaited<ReturnType<typeof prepareUserImage>>&{url:string};
export default function UserImages(){
 useLanguage();const {account}=useAccount(),membership=useMembership();
 const [images,setImages]=useState<UserImage[]>([]),[prepared,setPrepared]=useState<Prepared|null>(null),[title,setTitle]=useState(''),[rights,setRights]=useState(false),[selected,setSelected]=useState(''),[pieces,setPieces]=useState(300),[mode,setMode]=useState<'solo'|'private'>('solo'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[deleting,setDeleting]=useState<UserImage|null>(null);
 const lock=useRef(false),selection=useRef(0),mounted=useRef(true),fileInput=useRef<HTMLInputElement>(null);
 const active=membership.data?.summary.status==='active',summary=membership.data?.summary,chosen=images.find(image=>image.id===selected),level=LEVELS.find(l=>l.count===pieces)!;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;selection.current++;};},[]);
 useEffect(()=>()=>{if(prepared)URL.revokeObjectURL(prepared.url);},[prepared]);
 useEffect(()=>{membership.reload();setPrepared(null);setImages([]);setSelected('');setError('');if(!account)return;let alive=true;setLoading(true);apiJson<{images:UserImage[]}>('/api/user-images').then(data=>{if(alive)setImages(data.images);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;selection.current++;};},[account?.id,membership.reload]);
 async function chooseFile(file?:File){
  if(!file||lock.current)return;lock.current=true;setBusy('prepare');setError('');setPrepared(null);const token=++selection.current;
  try{const prepared=await prepareUserImage(file);if(!mounted.current||token!==selection.current)return;setPrepared({...prepared,url:URL.createObjectURL(prepared.image)});setTitle(file.name.replace(/\.[^.]+$/,'').slice(0,60));setRights(false);}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'图片处理失败');}
  finally{lock.current=false;if(mounted.current)setBusy('');if(fileInput.current)fileInput.current.value='';}
 }
 async function upload(event:React.FormEvent){
  event.preventDefault();if(!prepared||!account||!rights||lock.current)return;lock.current=true;setBusy('upload');setError('');
  try{const form=new FormData();form.set('image',prepared.image,'puzzle.webp');form.set('preview',prepared.preview,'preview.webp');form.set('title',title.trim());form.set('rights','yes');
   const response=await fetch('/api/user-images',{method:'POST',body:form,signal:AbortSignal.timeout(60000)}),data=await response.json().catch(()=>({error:'上传失败，请重试。'})) as {image:UserImage;error?:string};if(!response.ok)throw new Error(data.error||'上传失败，请重试。');
   if(mounted.current){setImages(old=>[data.image,...old.filter(image=>image.id!==data.image.id)]);setSelected(data.image.id);setPrepared(null);setRights(false);}
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'上传失败，请重试。');}
  finally{lock.current=false;if(mounted.current)setBusy('');}
 }
 async function start(){
  if(!chosen||!account||(mode==='private'&&!summary?.canCreate)||lock.current)return;lock.current=true;setBusy('start');setError('');
  try{const ticket=await apiJson<RoomTicket>('/api/rooms',{imageId:chosen.id,pieces,visibility:mode});saveTicket(ticket);location.assign('/room/'+ticket.room.id);}
  catch(e){if(mounted.current){setError(e instanceof Error?e.message:'开局失败');setBusy('');}lock.current=false;membership.reload();}
 }
 async function remove(){
  if(!deleting||lock.current)return;lock.current=true;setBusy('delete');setError('');
  try{await apiJson('/api/user-images/'+deleting.id,{action:'delete'});setImages(old=>old.filter(image=>image.id!==deleting.id));if(selected===deleting.id)setSelected('');setDeleting(null);}
  catch(e){setError(e instanceof Error?e.message:'删除失败，请重试');}
  finally{lock.current=false;setBusy('');}
 }
 return <CommunityShell active="personal"><main className="community-main user-images-page">
  <div className="user-images-heading"><div><p className="section-kicker">YOUR PHOTOS, PIECE BY PIECE</p><h1>{t('把自己的照片，拼成回忆。')}</h1><p>{t('登录即可免费上传照片，自己慢慢拼；会员还可创建私人房间邀请朋友。')}</p></div><a className="secondary" href="/personal">{t('返回个人空间')}<ArrowRight size={16}/></a></div>
  {!account&&<section className="user-upload-gate"><ImagePlus size={28}/><div><h2>{t('登录即可上传自己的图片')}</h2><p>{t('普通账号免费使用，最多保存 10 张。')}</p></div><a className="primary" href="/account?returnTo=/personal/images">{t('登录')}<ArrowRight size={16}/></a></section>}
  {error&&!deleting&&<p role="alert" className="form-error">{t(error)}</p>}
  <section className="user-upload-panel" aria-busy={!!busy}><div><h2><Upload size={23}/>{t('上传新图片')}</h2><p>{t('支持 JPG、PNG、WebP，原图最大 12 MB。')}</p><small>{t('上传前优化为最长 3072 像素的 WebP，不放大小图；实际保存尺寸会显示在预览中。')}</small></div>
   <button type="button" className="primary user-image-select-file" disabled={!account||!!busy||images.length>=USER_IMAGE_LIMIT} onClick={()=>fileInput.current?.click()}><ImagePlus size={18}/>{t("选择图片")}</button><input hidden ref={fileInput} id="user-image-file" aria-label={t("选择图片")} type="file" accept="image/jpeg,image/png,image/webp" disabled={!account||!!busy||images.length>=USER_IMAGE_LIMIT} onChange={event=>void chooseFile(event.target.files?.[0])}/>
   <p className="muted">{t('每个账号最多保存 10 张图片。图片仅自己和受邀玩家可见，不加入公开图库或用时榜。')}</p>
   {busy==='prepare'&&<p role="status">{t('正在准备图片预览…')}</p>}
   {prepared&&<form className="user-upload-preview" onSubmit={event=>void upload(event)}><img src={prepared.url} alt={t('上传预览')}/><div><label>{t('图片名称')}<input value={title} maxLength={60} required disabled={!!busy} onChange={event=>setTitle(event.target.value)}/><small>{t('1–60 个字符')}</small></label><p>{t('实际保存尺寸')}：{prepared.width} × {prepared.height} · {(prepared.image.size/1024/1024).toFixed(2)} MB</p><label className="user-image-rights"><input type="checkbox" checked={rights} disabled={!!busy} onChange={event=>setRights(event.target.checked)}/>{t('我有权使用这张图片，并同意仅与受邀玩家分享。')}</label><button className="primary" disabled={!rights||!title.trim()||!!busy}>{t(busy==='upload'?'正在上传…':'保存到我的图片')}<Upload size={16}/></button></div></form>}
  </section>
  <section className="my-image-library"><div className="user-image-library-heading"><h2>{t('我的图片')} <span>{images.length} / {USER_IMAGE_LIMIT}</span></h2><LockKeyhole size={20}/></div>
   {loading?<p role="status">{t('正在读取图片…')}</p>:images.length?<div className="user-image-grid">{images.map(image=><article key={image.id} className={selected===image.id?'selected':''}><button className="user-image-choice" disabled={!!busy} onClick={()=>setSelected(image.id)} aria-pressed={selected===image.id}><img src={image.thumbSrc} alt={image.title} loading="lazy"/><span>{image.title}{selected===image.id&&<Check size={17}/>}</span><small>{image.width} × {image.height}</small></button><button className="record-delete" aria-label={t('删除图片')+' · '+image.title} disabled={!!busy} onClick={()=>{setDeleting(image);setError('');}}><Trash2 size={15}/>{t('删除图片')}</button></article>)}</div>:<div className="user-image-empty"><ImagePlus size={38}/><p>{t('还没有上传图片。选一张旅行照、宠物照，或自己喜欢的画。')}</p></div>}
  </section>
  {chosen&&<section className="custom-puzzle-start"><img src={chosen.thumbSrc} style={{aspectRatio:level.cols/level.rows}} alt={t('拼图画幅预览')}/><div><h2>{chosen.title}</h2><p>{t('按所选片数等比居中裁切，拼块主体保持正方形。')}</p><div className="custom-puzzle-options"><label>{t('拼图片数')}<Select value={String(pieces)} onValueChange={value=>setPieces(Number(value))} disabled={!!busy}><SelectTrigger aria-label={t('拼图片数')}><SelectValue/></SelectTrigger><SelectContent>{LEVELS.map(level=><SelectItem key={level.count} value={String(level.count)}>{level.count} {t('片')}</SelectItem>)}</SelectContent></Select></label><fieldset disabled={!!busy}><legend>{t('游玩方式')}</legend><label><input type="radio" name="custom-mode" checked={mode==='solo'} onChange={()=>setMode('solo')}/>{t('独自拼图')}</label><label><input type="radio" name="custom-mode" checked={mode==='private'} onChange={()=>setMode('private')}/>{t('邀请朋友一起拼')}</label></fieldset></div>{mode==='private'&&<small>{t('私人房间沿用会员 3 间额度，每桌最多 8 人，朋友免费加入。')}</small>}<button className="primary" disabled={!account||!!busy||(mode==='private'&&!summary?.canCreate)} onClick={()=>void start()}>{t(busy==='start'?'正在创建…':mode==='private'?'创建私人房间':'开始拼图')}<ArrowRight size={17}/></button>{mode==='private'&&!active&&<p>{t('创建私人房间需要会员，独自拼图免费。')} <a href="/membership">{t('查看会员权益')}</a></p>}{mode==='private'&&membership.error&&<p role="alert">{t(membership.error)} <button className="text-button" onClick={membership.reload}>{t('重试')}</button></p>}{active&&mode==='private'&&!summary?.canCreate&&<p>{t('已有 3 个进行中的私人房间，请先完成其中一局')}</p>}<a className="text-button" href="/personal">{t('查看全部续玩进度')}</a></div></section>}
  <p className="user-images-retention">{t('上传与独自拼图免费。只有创建私人房间需要会员，已有房间按 30 天规则保留。')}</p>
  <AlertDialog open={!!deleting} onOpenChange={open=>{if(!open&&!busy)setDeleting(null);}}><AlertDialogContent><AlertDialogTitle>{t('删除这张图片？')}</AlertDialogTitle><AlertDialogDescription>{t('删除后无法恢复。有保存中拼图的图片暂不能删除，避免影响你和朋友的进度。')}</AlertDialogDescription>{error&&<p role="alert" className="form-error">{t(error)}</p>}<AlertDialogFooter><AlertDialogCancel disabled={!!busy}>{t('取消')}</AlertDialogCancel><button className="primary" disabled={!!busy} onClick={()=>void remove()}>{t(busy==='delete'?'正在删除…':'删除图片')}</button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main></CommunityShell>;
}
