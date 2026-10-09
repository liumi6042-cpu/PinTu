import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile,readFile,appendFile,rename,stat,rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { backupIfDue } from './database-backup.mjs';
const run=promisify(execFile);
export async function workerMemory(pid){
  if(process.platform!=='win32'||!Number.isSafeInteger(pid))return null;
  const command=`$items=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do { $added=0; foreach($item in $items){if($ids.Contains([int]$item.ParentProcessId) -and $ids.Add([int]$item.ProcessId)){$added++}} } while($added -gt 0); $total=0L; foreach($item in $items){if($ids.Contains([int]$item.ProcessId)){$total += [long]$item.WorkingSetSize}}; Write-Output $total`;
  try{const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:7000,maxBuffer:1024});const value=Number(stdout.trim());return value>0?value:null;}catch{return null;}
}
export async function monitorServer(root,metrics,workerPid,firstBackup){
  const directory=path.join(root,'work/local-server'),logPath=path.join(directory,'metrics.jsonl'),statusPath=path.join(directory,'status.json');await mkdir(directory,{recursive:true});
  let workerRss=null,lastBackup=firstBackup||null,backupError=null,stopped=false,saving=false,lastLog=0;
  async function sample(){if(saving||stopped)return;saving=true;try{workerRss=await workerMemory(workerPid);const snapshot={...metrics.snapshot(),gatewayRssBytes:process.memoryUsage().rss,workerTreeRssBytes:workerRss,lastBackup,backupError};await writeFile(statusPath+'.tmp',JSON.stringify(snapshot,null,2));await rename(statusPath+'.tmp',statusPath);
    if(Date.now()-lastLog>=60000){lastLog=Date.now();if((await stat(logPath).catch(()=>({size:0}))).size>5*1024*1024){await rm(logPath+'.2',{force:true});await rename(logPath+'.1',logPath+'.2').catch(()=>{});await rename(logPath,logPath+'.1');}await appendFile(logPath,JSON.stringify(snapshot)+'\n');}
  }catch(error){console.error('运行记录保存失败：'+error.message);}finally{saving=false;}}
  let backingUp=false;async function daily(){if(backingUp||stopped)return;backingUp=true;try{const result=await backupIfDue(root);if(result)lastBackup=result;backupError=null;}catch(error){backupError=error.message;console.error('自动备份失败：'+error.message);}finally{backingUp=false;}}
  const statsTimer=setInterval(()=>void sample(),15000),backupTimer=setInterval(()=>void daily(),3600000);void sample();
  return ()=>{stopped=true;clearInterval(statsTimer);clearInterval(backupTimer);};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));try{const s=JSON.parse(await readFile(path.join(root,'work/local-server/status.json'),'utf8')),mb=n=>n==null?'暂不可用':(n/1048576).toFixed(1)+' MB';console.log('一起拼图 · 本地服务器状态\n');console.log('更新时间：'+new Date(s.updatedAt).toLocaleString('zh-CN'));console.log('本次启动以来请求数：'+s.requests+'，服务器错误：'+s.errors5xx+'，限流拦截：'+s.limited);console.log('最近一分钟请求数：'+s.lastMinute.requests+'，95% 请求用时：'+(s.lastMinute.p95Ms??'—')+' ms');console.log('请求入口内存：'+mb(s.gatewayRssBytes)+'；本地运行器与游戏服务合计内存：'+mb(s.workerTreeRssBytes));console.log('最近自动备份：'+(s.lastBackup||'尚无记录'));if(s.backupError)console.log('备份需要处理：'+s.backupError);console.log('详细记录：'+path.join(root,'work/local-server/metrics.jsonl'));if(Date.now()-s.updatedAt>60000)console.log('这份状态已超过一分钟，服务器可能已停止。');}catch{console.log('暂无运行记录，请先启动本地拼图。');}
}
