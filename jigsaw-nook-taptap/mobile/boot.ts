import type {Platform} from './ports';
import {GameClient} from './client';
import {Stage} from './ui';
import {GameApp} from './app';
import {RenderProbe,type RenderProbeMode} from './render-probe';

/** The entire game is booted here on either host. Entry points contain no scenes. */
export function boot(platform:Platform){
 const client=new GameClient(platform),stage=new Stage(platform,path=>client.asset(path)),app=new GameApp(platform,client,stage);
 let frame=0,alive=true,hidden=false,reported=false,drawCount=0,nextPaintAt=0,lastFrameAt=0,lastMode=app.performanceMode;
 // Opt-in, device-local evidence. No identity, room token or network payload
 // is sampled. Measuring JS submission does not measure GPU composition.
 const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
 let probe:RenderProbe|null=null,probeResultPainted=false,swallowProbeInput=false;
 const environment=()=>{
  const ua=typeof navigator==='undefined'?'':navigator.userAgent,engine=/Chrome\/([\d.]+)/.exec(ua)?.[1],system=/Android ([\d.]+)/.exec(ua)?.[1];
  return ['Android '+(system??'未知')+' · Chrome '+(engine??'未知'),'画布 '+platform.canvas.width+'×'+platform.canvas.height+' · DPR '+platform.viewport().dpr];
 };
 const stopProbe=()=>{probe?.dispose();probe=null;probeResultPainted=false;swallowProbeInput=false;stage.invalidate();};
 const probePanel=(lines:string[])=>{const w=Math.min(340,stage.w-20),x=(stage.w-w)/2,y=Math.max(platform.viewport().top+12,(stage.h-(lines.length*20+22))/2);stage.panel({x,y,w,h:lines.length*20+22});lines.forEach((line,i)=>stage.text(line,x+9,y+11+i*20,12,stage.palette.ink,500,w-18));};
 const paintProbe=(mode:RenderProbeMode,changed:boolean)=>{
  // The frozen window performs zero Canvas commands after its first frame.
  if(mode==='frozen'&&!changed)return;
  stage.begin();try{if(mode!=='flat')app.drawForRenderProbe(mode==='direct');else{const c=stage.ctx;c.fillStyle=stage.palette.rose;c.fillRect(stage.w/2-12+(Math.sin(clock()/300)*30),stage.h*.7,24,24);}probePanel(['卡顿对照 '+probe!.label,'请持续划动屏幕，约14秒完成','测试期间不会移动拼片']);}finally{stage.endFrame();}
 };
 app.onRenderProbe=()=>{
  if(probe||!app.diagnosticsAvailable||platform.config.id!=='taptap'||!app.renderProbeAvailable)return;
  app.input({type:'cancel',points:[],changed:[]});probe=new RenderProbe(clock,()=>platform.inputDiagnostics?.());probeResultPainted=false;
 };
 let sampleStart:number|null=null,lagLastAt=0;
 const paints:{at:number;ms:number}[]=[],inputs:number[]=[];
 const callbacks:number[]=[],nativeSamples:{at:number;pointerMoves:number;touchMoves:number}[]=[];
 let lastViewport=platform.viewport();
 const resetSamples=()=>{sampleStart=null;lagLastAt=0;paints.length=0;inputs.length=0;callbacks.length=0;nativeSamples.length=0;};
 // Scene mutations and board animation ticks invalidate the stage. A room
 // staying open by itself is not a reason to clear and paint the whole canvas.
 const draw=(time:number)=>{
  frame=0;if(!alive||hidden)return;const now=Number.isFinite(time)?time:Date.now(),mode=app.performanceMode,interval=mode==='power-saving'?1000/30:0;
  if(probe){
   try{
    if(!probe.finished)probe.tick(paintProbe);
    if(probe.finished&&!probeResultPainted){
     stage.begin();try{app.draw();probePanel(['卡顿对照结果（单位：次/秒）',...probe.resultLines(),...environment(),'测试期间未操作拼片；点击返回']);}finally{stage.endFrame();}
     probeResultPainted=true;
     // Device-local diagnostics only; never store identity, URLs or room data.
     try{platform.storage.set('jigsaw:render-probe:last',JSON.stringify({samples:probe.samples,environment:environment()}));}catch{}
    }
   }catch{stopProbe();platform.alert('本次对照未完成，已恢复游戏');}
   if(alive&&!hidden)frame=platform.frame(draw);return;
  }
  if(mode!==lastMode||now<lastFrameAt)nextPaintAt=now;lastMode=mode;lastFrameAt=now;
  const tickAt=clock(),gapMs=lagLastAt>0?Math.max(0,tickAt-lagLastAt):0;lagLastAt=tickAt;
  if(app.performanceInfoVisible){if(sampleStart===null)sampleStart=tickAt;callbacks.push(tickAt);while(callbacks.length&&callbacks[0]<tickAt-1000)callbacks.shift();if(callbacks.length>500)callbacks.shift();const native=platform.inputDiagnostics?.();if(native){nativeSamples.push({at:tickAt,...native});while(nativeSamples.length>1&&nativeSamples[0].at<tickAt-1000)nativeSamples.shift();if(nativeSamples.length>500)nativeSamples.shift();}}
  // Keep the full backing resolution. Only continuous paints are capped;
  // dirty work remains pending, so the final feedback frame is never lost.
  if(stage.dirty&&(!interval||now+.1>=nextPaintAt)){
   const measure=app.performanceInfoVisible,started=clock();
   if(!measure){sampleStart=null;paints.length=0;inputs.length=0;callbacks.length=0;nativeSamples.length=0;}else if(sampleStart===null)sampleStart=started;
   let drawMs=0;
   try{stage.begin();app.draw();drawCount++;
    if(measure){
     const cutoff=started-1000;while(paints.length&&paints[0].at<cutoff)paints.shift();while(inputs.length&&inputs[0]<cutoff)inputs.shift();
     const span=Math.min(1000,started-sampleStart!),avg=paints.length?paints.reduce((sum,p)=>sum+p.ms,0)/paints.length:0,peak=paints.reduce((n,p)=>Math.max(n,p.ms),0);
     const native=platform.inputDiagnostics?.(),first=nativeSamples[0],nativeSpan=first?started-first.at:0;
     const rates=native&&first&&nativeSpan>=500?['触摸 '+Math.round((native.touchMoves-first.touchMoves)*1000/nativeSpan)+'/秒 · 指针 '+Math.round((native.pointerMoves-first.pointerMoves)*1000/nativeSpan)+'/秒', '输入路径：'+(native.mode==='touch'?'原生触摸':'指针')]:[];
     const lines=[span>=500?'重画 '+Math.round(paints.length*1000/span)+'/秒 · 游戏输入 '+Math.round(inputs.length*1000/span)+'/秒':'请持续拖动以采样',span>=500?'刷新回调 '+Math.round(callbacks.length*1000/span)+'/秒':'刷新回调采样中', 'JS绘制 '+avg.toFixed(1)+'ms · 峰值 '+peak.toFixed(1)+'ms',...rates,...app.performanceDetails(), '画布 '+platform.canvas.width+'×'+platform.canvas.height];
     const x=10,y=platform.viewport().top+110,w=Math.min(290,stage.w-20);stage.panel({x,y,w,h:lines.length*17+12});lines.forEach((line,i)=>stage.text(line,x+7,y+6+i*17,11,stage.palette.ink,500,w-14));
    }
   }catch(error){if(!reported){reported=true;console.error('[shared-game] render failed',error);platform.alert('画面暂时遇到问题，请退出后重试');}}
   finally{stage.endFrame();drawMs=Math.max(0,clock()-started);if(measure){paints.push({at:started,ms:drawMs});if(paints.length>240)paints.shift();}}
   app.recordFrameSample?.(gapMs,drawMs,true);
   nextPaintAt=interval?(nextPaintAt>0&&now-nextPaintAt<interval?nextPaintAt+interval:now+interval):now;
  }else if(gapMs>0){
   app.recordFrameSample?.(gapMs,0,false);
  }
  if(alive&&!hidden)frame=platform.frame(draw);
 };
 const offInput=platform.onInput(input=>{
  if(input.type==='down'||input.type==='key'&&input.keyDown)platform.audio?.unlock();
  if(probe){if(input.type==='move')probe.input();if(probe.finished&&input.type==='down'){stopProbe();swallowProbeInput=true;resetSamples();nextPaintAt=0;}return;}
  if(swallowProbeInput){if(input.type==='cancel'||(input.type==='up'&&!input.points.length))swallowProbeInput=false;return;}
  if(app.performanceInfoVisible&&input.type==='move'){inputs.push(clock());if(inputs.length>1000)inputs.shift();}return app.input(input);
 }),offResize=platform.onResize(()=>{const view=platform.viewport();if(view.width===lastViewport.width&&view.height===lastViewport.height&&view.dpr===lastViewport.dpr&&view.top===lastViewport.top&&view.bottom===lastViewport.bottom)return;lastViewport=view;stopProbe();app.resize();stage.resize();});
 const offHide=platform.onHide(()=>{hidden=true;stopProbe();resetSamples();if(frame)platform.cancelFrame(frame);frame=0;}),offShow=platform.onShow(()=>{hidden=false;nextPaintAt=0;stage.resize();if(alive&&!frame)frame=platform.frame(draw);});
 void platform.loadFont?.('assets/fonts/jigsaw-ui-sc.'+(platform.config.id==='wechat'?'ttf':'woff2')).then(font=>{if(font){stage.font='"'+font+'", sans-serif';stage.invalidate();}});
 frame=platform.frame(draw);void app.start();
 return {app,client,stage,diagnostics:()=>({hidden,drawCount,dirty:stage.dirty,renderError:reported}),destroy(){if(!alive)return;alive=false;stopProbe();app.onRenderProbe=null;platform.cancelFrame(frame);offInput();offResize();offHide();offShow();app.destroy();platform.audio?.dispose();stage.destroy();}};
}
