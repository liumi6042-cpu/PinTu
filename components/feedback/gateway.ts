// Shared server-only adapter. Copied into each site by sync-feedback.mjs.
export type FeedbackSettings={FEEDBACK_URL?:string;FEEDBACK_SITE_KEY?:string;FEEDBACK_ORIGIN?:string};
const encoder=new TextEncoder();
const cookies=(value:string|null)=>Object.fromEntries((value||'').split(';').map(v=>{const i=v.indexOf('=');return i<0?['','']:[v.slice(0,i).trim(),v.slice(i+1)];}));
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
async function hmac(secret:string,value:string){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
const json=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}});
async function limitedBody(request:Request,limit:number){const reader=request.body?.getReader();if(!reader)throw Error('invalidInput');const parts:Uint8Array[]=[];let size=0;try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit){await reader.cancel();throw Error('tooLarge');}parts.push(r.value);}}finally{reader.releaseLock();}const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;}
export async function feedbackGateway(request:Request,settings:FeedbackSettings,site:'tarot'|'puzzle',localOnly=false){
 const url=new URL(request.url),origin=settings.FEEDBACK_ORIGIN||url.origin,parts=url.pathname.replace(/^\/api\/feedback\/?/,'').split('/').filter(Boolean),cookieValues=cookies(request.headers.get('cookie'));
 const secure=origin.startsWith('https://'),guestName=secure?'__Host-feedback_guest':'feedback_guest';
 const cookie=(name:string,value:string,age:number,path='/')=>`${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
 try{
  if(!settings.FEEDBACK_URL||!settings.FEEDBACK_SITE_KEY||settings.FEEDBACK_SITE_KEY.length<32){console.warn('Feedback service settings are incomplete');return json({error:'unavailable'},503);}
  const serviceURL=new URL(settings.FEEDBACK_URL);
  if(localOnly&&!['127.0.0.1','localhost','[::1]'].includes(serviceURL.hostname))return json({error:'unavailable'},503);
  if(request.method!=='GET'&&(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'invalidOrigin'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'methodNotAllowed'},405);
  let session=cookieValues[guestName]||'',guestId=session.split('.')[0],valid=false;
  if(/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(session))valid=(await hmac(settings.FEEDBACK_SITE_KEY,'guest:'+guestId))===session.split('.')[1];
  const bootstrap=request.method==='GET'&&!parts.length;
  if(!valid&&!bootstrap)return json({error:'sessionRequired'},403);
  if(!valid){guestId=id();session=guestId+'.'+await hmac(settings.FEEDBACK_SITE_KEY,'guest:'+guestId);}
  const headers:Record<string,string>={Authorization:`Bearer ${settings.FEEDBACK_SITE_KEY}`,'X-Feedback-Actor':await hmac(settings.FEEDBACK_SITE_KEY,'actor:'+guestId),'X-Feedback-IP':await hmac(settings.FEEDBACK_SITE_KEY,'ip:'+(request.headers.get('x-real-ip')||request.headers.get('cf-connecting-ip')||'local-shared'))};
  let action='',body:Uint8Array|undefined,ticketId='';
  if(bootstrap)action='ready';
  else if(request.method==='POST'&&!parts.length){action='submit';headers['Content-Type']=request.headers.get('content-type')||'';body=await limitedBody(request,16*1024*1024);}
  else if(request.method==='POST'&&parts.length===1&&parts[0]==='access'){
   action='access';headers['Content-Type']='application/json';body=await limitedBody(request,10000);const value=JSON.parse(new TextDecoder().decode(body));ticketId=value.id;
   if(typeof ticketId!=='string'||!/^[\w-]{43}$/.test(ticketId))return json({error:'linkExpired'},410);
  }else if(request.method==='GET'&&parts[0]==='ticket'&&[2,3].includes(parts.length)&&parts.slice(1).every(v=>/^[\w-]{43}$/.test(v))){
   action=parts.join('/');headers['X-Feedback-Viewer']=cookieValues['feedback_view_'+parts[1]]||'';
  }else return json({error:'notFound'},404);
  const upstream=await fetch(new URL(`/v1/${site}/${action}`,serviceURL),{method:request.method,headers,body:body as BodyInit|undefined,redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(upstream.status>=300&&upstream.status<400)return json({error:'unavailable'},503);
  const responseHeaders:Record<string,string>={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(upstream.headers.has('retry-after'))responseHeaders['Retry-After']=upstream.headers.get('retry-after')!;
  if(bootstrap&&upstream.ok)responseHeaders['Set-Cookie']=cookie(guestName,session,180*86400);
  if(action==='access'&&upstream.ok){const value=await upstream.json() as {viewerSession:string};responseHeaders['Set-Cookie']=cookie('feedback_view_'+ticketId,value.viewerSession,3600,'/api/feedback');return json({ok:true},200,responseHeaders);}
  responseHeaders['Content-Type']=upstream.headers.get('content-type')?.startsWith('image/webp')?'image/webp':'application/json';
  return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
 }catch(error){const type=error instanceof Error?error.message:'';console.warn('Feedback gateway error class:',error instanceof Error?error.name:'Unknown');return json({error:type==='tooLarge'?'tooLarge':'unavailable'},type==='tooLarge'?413:503);}
}
