import { DatabaseSync, backup } from 'node:sqlite';
import { readdir, mkdir, readFile, writeFile, realpath, lstat, rename, rm } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const marker='together-puzzle-sqlite-backup-v1';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function inside(root,target){const rel=path.relative(path.resolve(root),path.resolve(target));if(rel.startsWith('..')||path.isAbsolute(rel)||!rel)throw new Error('备份路径超出指定目录');return path.resolve(target);}
async function checked(root,target){inside(root,target);inside(await realpath(root),await realpath(target));return target;}
async function databases(root){const found=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=inside(root,path.join(dir,item.name));if(item.isSymbolicLink())throw new Error('数据库目录不能包含符号链接');if(item.isDirectory())await walk(p);else if(item.isFile()&&item.name.endsWith('.sqlite'))found.push(p);}}await walk(root);return found;}
function integrity(file){const db=new DatabaseSync(file,{readOnly:true});try{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('数据库完整性检查失败');}finally{db.close();}}
async function copyDatabase(source,target){const db=new DatabaseSync(source,{readOnly:true,timeout:5000});try{await backup(db,target,{rate:100});}finally{db.close();}integrity(target);}
export async function createBackup(root=projectRoot,{kind='manual',dataRoot=path.join(root,'.wrangler/state/v3/d1'),now=new Date()}={}){
  if(!['manual','automatic','before-restore'].includes(kind))throw new Error('备份类型无效');
  const files=await databases(dataRoot).catch(e=>{if(e.code==='ENOENT')return [];throw e;});if(!files.length)return null;
  const parent=path.join(root,'work/backups',kind);await mkdir(parent,{recursive:true});
  const stamp=now.toISOString().replaceAll(':','-')+'-'+randomBytes(3).toString('hex'),folder=inside(parent,path.join(parent,stamp));await mkdir(folder);
  const manifest={format:marker,createdAt:now.toISOString(),kind,files:[]};
  for(const source of files){await checked(dataRoot,source);const relative=path.relative(dataRoot,source).split(path.sep).join('/'),target=inside(folder,path.join(folder,relative));await mkdir(path.dirname(target),{recursive:true});await copyDatabase(source,target);const bytes=await readFile(target);manifest.files.push({path:relative,bytes:bytes.length,sha256:digest(bytes)});}
  await writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2));await verifyBackup(folder);return folder;
}
export async function verifyBackup(folder){
  const manifest=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
  if(manifest.format!==marker||!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('不是有效的拼图数据库备份');
  const paths=new Set();for(const file of manifest.files){if(typeof file.path!=='string'||!file.path.endsWith('.sqlite')||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||paths.has(file.path))throw new Error('备份文件路径无效');paths.add(file.path);const target=inside(folder,path.join(folder,file.path));await checked(folder,target);const bytes=await readFile(target);if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw new Error('备份校验失败，文件可能被修改');integrity(target);}return manifest;
}
export async function pruneAutomatic(root=projectRoot,keep=7){
  const parent=path.join(root,'work/backups/automatic');const entries=await readdir(parent,{withFileTypes:true}).catch(()=>[]),valid=[];
  for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const folder=inside(parent,path.join(parent,entry.name));try{const m=await verifyBackup(folder);if(m.kind==='automatic'&&Number.isFinite(Date.parse(m.createdAt)))valid.push({folder,date:Date.parse(m.createdAt)});}catch{/* Never delete unrecognized or damaged backups. */}}
  valid.sort((a,b)=>b.date-a.date);for(const {folder} of valid.slice(keep)){await checked(parent,folder);await rm(folder,{recursive:true});}
}
async function serverRunning(){const ports=await Promise.all([3000,3002].map(port=>new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.setTimeout(1000,()=>{socket.destroy();resolve(true);});})));return ports.some(Boolean);}
export async function restoreBackup(root,folder,{confirm=false,dataRoot=path.join(root,'.wrangler/state/v3/d1'),isRunning=serverRunning}={}){
  if(!confirm)throw new Error('恢复会回退数据库，请停止服务器后添加 --confirm-restore');
  if(await isRunning())throw new Error('请先关闭 3000 端口的本地服务器，再恢复数据库');
  await checked(path.join(root,'work/backups'),folder);const manifest=await verifyBackup(folder);
  await mkdir(dataRoot,{recursive:true});const emergency=await createBackup(root,{kind:'before-restore',dataRoot});
  const staged=[];for(const file of manifest.files){const target=inside(dataRoot,path.join(dataRoot,file.path));await mkdir(path.dirname(target),{recursive:true});if(path.dirname(target)!==path.resolve(dataRoot))await checked(dataRoot,path.dirname(target));if((await lstat(target).catch(()=>null))?.isSymbolicLink())throw new Error('恢复目标不能为符号链接');const temporary=target+'.restore-'+randomBytes(4).toString('hex');await copyDatabase(path.join(folder,file.path),temporary);staged.push({target,temporary,relative:file.path});}
  // All copies are verified before replacement. The current database is separately backed up first.
  if(await isRunning())throw new Error('检测到服务器重新启动，已取消恢复');
  const replaced=[];try{for(const item of staged){const {target,temporary}=item;replaced.push(item);for(const suffix of ['-wal','-shm']){const sidecar=inside(dataRoot,target+suffix);await rm(sidecar,{force:true});}await rename(temporary,target);}}
  catch(error){for(const item of replaced){const original=emergency&&path.join(emergency,item.relative);if(original&&await lstat(original).catch(()=>null)){const temp=item.target+'.rollback';await copyDatabase(original,temp);await rename(temp,item.target);}else await rm(inside(dataRoot,item.target),{force:true});}throw new Error('恢复失败，已回退已替换文件：'+error.message);}
  return {restored:staged.length,emergency};
}
export async function backupIfDue(root=projectRoot){
  const parent=path.join(root,'work/backups/automatic');const entries=await readdir(parent,{withFileTypes:true}).catch(()=>[]);let latest=0;
  for(const item of entries)if(item.isDirectory()&&!item.isSymbolicLink()){try{const m=await verifyBackup(path.join(parent,item.name));latest=Math.max(latest,Date.parse(m.createdAt)||0);}catch{}}
  if(Date.now()-latest<86400000)return null;
  const folder=await createBackup(root,{kind:'automatic'});if(folder)await pruneAutomatic(root);return folder;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,folder]=process.argv.slice(2);
  try{if(command==='backup')console.log(await createBackup(projectRoot)||'尚无数据库');else if(command==='verify')console.log(await verifyBackup(path.resolve(folder)));else if(command==='restore')console.log(await restoreBackup(projectRoot,path.resolve(folder),{confirm:process.argv.includes('--confirm-restore')}));else if(command==='daily')console.log(await backupIfDue()||'最近 24 小时已有备份');else throw new Error('用法：backup | verify 备份目录 | restore 备份目录 --confirm-restore | daily');}catch(error){console.error(error.message);process.exitCode=1;}
}
