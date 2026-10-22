import {createDailyContent} from './daily-content.mjs';

/** Request calls keep their pinned release. The independent timer pins one fresh release. */
export function createManagedDailyContent({readSnapshot,legacy=null,photos,galleryPhotos,fallback,appearanceDir,now=Date.now}){
 let activeDocument,timer;
 const managed=createDailyContent({readConfiguration:()=>activeDocument,appearanceDir,photos,fallback,now});
 const ordinary=legacy??{tick:()=>null,select:fallback,albumEntries:()=>[],managedImageIds:()=>new Set(),releasedImageIds:()=>new Set(),galleryPhotos:()=>galleryPhotos,targetAlbums:()=>[],collectiblePhotos:()=>photos};
 const invoke=(name,args)=>{
  const snapshot=readSnapshot(),previous=activeDocument;activeDocument=snapshot?.documents.daily;
  try{return (snapshot?managed:ordinary)[name](...args);}
  finally{activeDocument=previous;}
 };
 const result=Object.fromEntries(['tick','select','albumEntries','managedImageIds','releasedImageIds','galleryPhotos','targetAlbums'].map(name=>[name,(...args)=>invoke(name,args)]));
 return {...result,collectiblePhotos:()=>photos,start(){
  if(timer)return;invoke('tick',[now()]);
  timer=setInterval(()=>{try{invoke('tick',[now()]);}catch{console.error('每日内容暂时不可用，等待下一次校验。');}},30000);timer.unref();
 },close(){if(timer)clearInterval(timer);timer=undefined;managed.close();legacy?.close();}};
}
