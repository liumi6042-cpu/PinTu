import { readFile,mkdir,open } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import path from 'node:path';

// Reuse the shared feedback service; it outlives this game because other local
// sites can use it too. No production configuration or database is contacted.
export async function ensureLocalFeedback(root) {
  let config;
  try { config=parseEnv(await readFile(path.join(root,'.env.feedback'),'utf8')); }
  catch { return false; }
  if(!config.FEEDBACK_URL||!config.FEEDBACK_SITE_KEY)return false;
  const origin=new URL(config.FEEDBACK_URL);
  if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))return false;
  const ready=async()=>{try{const r=await fetch(new URL('/healthz',origin),{signal:AbortSignal.timeout(1000)});const data=await r.json();return r.ok&&data.app==='shared-feedback-center'&&data.ready===true;}catch{return false;}};
  if(await ready())return true;
  if(!config.FEEDBACK_LOCAL_PROJECT)return false;
  const project=path.resolve(root,config.FEEDBACK_LOCAL_PROJECT);
  const serviceFile=path.join(project,'services/feedback-center/server.mjs');
  const configFile=path.join(project,'work/feedback-center/config.json');
  const shared=JSON.parse(await readFile(configFile,'utf8'));
  if(shared.host!=='127.0.0.1'||String(shared.port)!==(origin.port||'80')||shared.sites?.puzzle!==config.FEEDBACK_SITE_KEY)throw new Error('Local feedback configuration does not match this puzzle site.');
  await readFile(serviceFile);
  const logs=path.join(root,'work/local-server');await mkdir(logs,{recursive:true});
  const out=await open(path.join(logs,'feedback.stdout.log'),'a'),err=await open(path.join(logs,'feedback.stderr.log'),'a');
  try {
    const child=spawn(process.execPath,[serviceFile],{cwd:project,env:{...process.env,FEEDBACK_CONFIG_PATH:configFile},detached:true,windowsHide:true,stdio:['ignore',out.fd,err.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    child.unref();
  } finally { await out.close();await err.close(); }
  for(let attempt=0;attempt<20;attempt++){if(await ready())return true;await new Promise(r=>setTimeout(r,250));}
  return false;
}
