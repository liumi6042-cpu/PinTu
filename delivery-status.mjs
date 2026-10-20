import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {basename,join,relative,resolve,sep} from 'node:path';
import {webTreeName} from './project-layout.mjs';

const fail=message=>{throw Object.assign(new Error(message),{status:409,code:'INVALID_DELIVERY_RECEIPT'});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const kinds=['thumbnail','optimized'];
const fields={thumbnail:'thumbSrc',optimized:'optimizedSrc'};
const inside=(root,file)=>{const part=relative(root,file);return part!==''&&part!=='..'&&!part.startsWith('..'+sep)&&!resolve(part).startsWith('\\\\')&&!/^[A-Za-z]:/.test(part);};
function fileWithin(root,path){
 const target=resolve(root,path);if(!inside(root,target))fail('交付核验路径超出项目目录。');
 let cursor=root;for(const part of relative(root,target).split(sep)){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())fail('交付核验路径不能包含符号链接。');}
 const real=realpathSync(target);if(!inside(root,real)||!lstatSync(real).isFile())fail('交付核验对象必须是项目内普通文件。');return real;
}
const jsonAt=(root,path)=>JSON.parse(readFileSync(fileWithin(root,path),'utf8'));
export const runtimeAvailable=asset=>asset.runtimeAvailable??asset.lifecycle==='retained';
export const pendingDeliveryFiles=asset=>kinds.map(kind=>({url:'/puzzles/'+basename(asset.delivery[kind].path),bytes:asset.delivery[kind].bytes,sha256:asset.delivery[kind].sha256}));

/** New runtime entries must be exact derivatives of the existing private registry. */
export function validatePendingRuntimePhoto(asset,photo,record){
 if(!asset||!photo||!record||photo.id!==asset.id||record.id!==asset.id||photo.origin!==asset.origin||record.origin!==asset.origin||record.sha256!==asset.source.sha256||record.width!==asset.source.width||record.height!==asset.source.height||record.delivery?.sourceSha256!==asset.source.sha256)
  fail('新增运行素材未匹配待整理原件：'+(photo?.id??asset?.id??'未知'));
 if(photo.src!=='/puzzles/'+asset.id+'.png')fail('新增运行素材原件引用不符：'+asset.id);
 for(const kind of kinds){const expected=asset.delivery[kind],item=record.delivery?.[kind],url='/puzzles/'+basename(expected.path);
  if(photo[fields[kind]]!==url||!item||item.src!==url||['sha256','bytes','width','height','format','lossless'].some(key=>item[key]!==expected[key]))fail('新增运行素材交付登记不符：'+asset.id+' / '+kind);
 }
 return photo;
}

/** Deployment evidence is private and excluded from drafts/source fingerprints.
 * Fixed roots prevent a forged receipt from selecting unrelated files. A receipt
 * only becomes available after both local release inventories still match it. */
export function readDeliveredAssets(projectRoot,pending){
 const project=realpathSync(projectRoot),receiptPath='content-admin/work/delivered-assets.json';
 if(!existsSync(join(project,receiptPath)))return {availableIds:new Set(),receipt:null};
 let receipt;try{receipt=jsonAt(project,receiptPath);}catch(cause){if(cause.code==='INVALID_DELIVERY_RECEIPT')throw cause;fail('双端图片交付回执无法读取。');}
 if(receipt?.schema!=='jigsaw-delivered-assets/v1'||!Array.isArray(receipt.images)||receipt.images.length>2000||!['webRelease','mobileRelease'].every(key=>typeof receipt[key]==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(receipt[key]))||typeof receipt.verifiedAt!=='string'||!Number.isFinite(Date.parse(receipt.verifiedAt)))fail('双端图片交付回执结构无效。');
 const roots=[webTreeName(project),'jigsaw-nook-taptap'].map(path=>{const root=resolve(project,path);if(!inside(project,root))fail('交付目录无效。');let cursor=project;for(const part of path.split('/')){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())fail('交付目录不能包含符号链接。');}return realpathSync(root);});
 const catalogs=roots.map(root=>jsonAt(root,'content/puzzle-catalog.json'));
 for(const catalog of catalogs)if(!Array.isArray(catalog)||new Set(catalog.map(photo=>photo.id)).size!==catalog.length)fail('双端运行图片登记无效或重复。');
 const availableIds=new Set();
 for(const image of receipt.images){
  const asset=pending.byId.get(image?.id);if(!asset||availableIds.has(image.id)||image.sourceSha256!==asset.source.sha256||!Array.isArray(image.files)||image.files.length!==kinds.length)fail('双端交付回执的图片身份无效。');
  const expected=pendingDeliveryFiles(asset);
  if(new Set(image.files.map(file=>file?.url)).size!==kinds.length||expected.some(file=>!image.files.some(item=>item.url===file.url&&item.bytes===file.bytes&&item.sha256===file.sha256)))fail('双端交付回执与登记文件不一致：'+image.id);
  for(let index=0;index<roots.length;index++){
   const root=roots[index],photo=catalogs[index].find(item=>item.id===image.id),record=jsonAt(root,'content/image-provenance/'+image.id+'.json');
   validatePendingRuntimePhoto(asset,photo,record);
   for(const file of expected){const bytes=readFileSync(fileWithin(root,'public'+file.url));if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)fail('双端已交付文件校验失败：'+image.id);}
  }
  availableIds.add(image.id);
 }
 return {availableIds,receipt};
}
