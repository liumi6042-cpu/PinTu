import { NEW_GAME_LEVELS as LEVELS } from './piece-policy';
import { PHOTO_IDS } from './puzzle-catalog';
type Tool={name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown};
type Registry={registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>};
export function registerPuzzleTools(actions:{read:()=>unknown;start:(imageId:string,pieces:number)=>Promise<unknown>}) {
  const context=(document as Document&{modelContext?:Registry}).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const tools:Tool[]=[{name:'read_puzzle_session',title:'查看拼图状态',description:'读取当前屏幕、可选拼图、支持的片数与当前拼图进度。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>actions.read()},
    {name:'start_puzzle_session',title:'开始或继续单人拼图',description:'从选图页开始指定图片及片数的拼图，有未完成存档时继续存档。在游玩页不能切换或覆盖当前拼图。',inputSchema:{type:'object',properties:{imageId:{type:'string',enum:PHOTO_IDS},pieces:{type:'integer',enum:LEVELS.map(level=>level.count)}},required:['imageId','pieces'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input:unknown)=>{if(!input||typeof input!=='object')throw new Error('需要 imageId 和 pieces');const v=input as Record<string,unknown>;if(Object.keys(v).some(k=>k!=='imageId'&&k!=='pieces')||typeof v.imageId!=='string'||typeof v.pieces!=='number')throw new Error('参数格式错误');return actions.start(v.imageId,v.pieces);}}];
  for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional host capability. */}}
  return()=>lifecycle.abort();
}
