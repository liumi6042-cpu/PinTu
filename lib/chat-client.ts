import { chatText, mergeChat, type ChatFeed, type ChatMessage } from './room-chat';
import { retryDelay } from './request-backoff';
export type ChatState={messages:ChatMessage[];loaded:boolean;error:string;sending:boolean};
export class ChatClient {
 state:ChatState={messages:[],loaded:false,error:'',sending:false};
 private cursor=0;private opened=false;private stopped=true;private running=false;
 private timer:ReturnType<typeof setTimeout>|null=null;private retryAt=0;private failures=0;
 private controllers=new Set<AbortController>();
 private pending:{text:string;requestId:string}|null=null;
 private roomId:string;private token:string;private receive:(state:ChatState)=>void;
 private ready:()=>boolean;private hidden:()=>boolean;
 constructor(roomId:string,token:string,receive:(state:ChatState)=>void,ready:()=>boolean,hidden:()=>boolean=()=>false){
  this.roomId=roomId;this.token=token;this.receive=receive;this.ready=ready;this.hidden=hidden;
 }
 private update(next:Partial<ChatState>){if(this.stopped)return;this.state={...this.state,...next};this.receive(this.state);}
 private accept(feed:ChatFeed){
  const messages=mergeChat(this.state.messages,feed.messages),changed=messages.length!==this.state.messages.length||messages.at(-1)?.id!==this.state.messages.at(-1)?.id;
  this.cursor=Math.max(this.cursor,feed.cursor);
  if(changed||!this.state.loaded||this.state.error)this.update({messages,loaded:true,error:''});
 }
 start(){if(!this.stopped)return;this.stopped=false;this.refresh();}
 setOpen(open:boolean){if(this.opened===open)return;this.opened=open;this.refresh();}
 refresh(){this.schedule(0);}
 private schedule(delay:number){
  if(this.timer)clearTimeout(this.timer);this.timer=null;
  if(this.stopped||this.running||this.hidden())return;
  this.timer=setTimeout(()=>void this.poll(),Math.max(delay,this.retryAt-Date.now()));
 }
 private async request(body?:unknown){
  const controller=new AbortController();this.controllers.add(controller);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(`/api/rooms/${this.roomId}/chat?after=${this.cursor}`,{method:body===undefined?'GET':'POST',
    headers:{Authorization:'Bearer '+this.token,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:controller.signal});
   const data=await response.json().catch(()=>null) as (ChatFeed&{message?:ChatMessage;error?:string})|null;
   if(!response.ok){
    if(response.status===429||response.status===503)this.retryAt=Date.now()+retryDelay(response.headers.get('Retry-After'));
    throw new Error(data?.error||'聊天暂时未连接，正在重试');
   }
   if(!data||!Array.isArray(data.messages)||!Number.isSafeInteger(data.cursor))throw new Error('聊天暂时未连接，正在重试');
   return data;
  }finally{clearTimeout(timeout);this.controllers.delete(controller);}
 }
 private async poll(){
  if(this.stopped||this.hidden())return;
  if(!this.ready()){if(this.state.error!=='请先重新连接房间')this.update({error:'请先重新连接房间'});this.schedule(2500);return;}
  this.running=true;
  try{const feed=await this.request();if(!this.stopped){this.accept(feed);this.failures=0;}}
  catch(error){if(!this.stopped){this.failures++;const message=error instanceof Error?error.message:'聊天暂时未连接，正在重试';if(message!==this.state.error)this.update({error:message});}}
  finally{this.running=false;this.schedule(this.failures?Math.min(30000,2500*2**Math.min(this.failures,4)):this.opened?2500:12000);}
 }
 async send(raw:string){
  const text=chatText(raw);if(!text)throw new Error('消息请填写 1–300 个字');
  if(this.stopped||!this.ready())throw new Error('请先重新连接房间');
  if(this.state.sending)throw new Error('消息正在发送');
  if(Date.now()<this.retryAt)throw new Error('发送太快了，请稍等片刻再试');
  if(this.pending?.text!==text)this.pending={text,requestId:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('')};
  this.update({sending:true});
  try{
   const feed=await this.request({...this.pending,after:this.cursor});
   if(!feed.message)throw new Error('消息未发送，请重试');
   if(!this.stopped){this.accept(feed);this.pending=null;}
  }catch(error){throw new Error(error instanceof Error&&error.name!=='AbortError'?error.message:'消息未发送，请重试');}
  finally{this.update({sending:false});}
 }
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);this.timer=null;for(const controller of this.controllers)controller.abort();this.controllers.clear();}
}
