import type {Platform} from './ports';
import {GameClient} from './client';
import {Stage} from './ui';
import {GameApp} from './app';

/** The entire game is booted here on either host. Entry points contain no scenes. */
export function boot(platform:Platform){
 const client=new GameClient(platform),stage=new Stage(platform,path=>client.asset(path)),app=new GameApp(platform,client,stage);
 let frame=0,alive=true,hidden=false,reported=false,drawCount=0;
 const draw=()=>{if(!alive)return;if(!hidden&&(stage.dirty||app.route==='room')){try{stage.begin();app.draw();drawCount++;}catch(error){if(!reported){reported=true;console.error('[shared-game] render failed',error);platform.alert('画面暂时遇到问题，请退出后重试');}}}frame=platform.frame(draw);};
 const offInput=platform.onInput(input=>{app.input(input);}),offResize=platform.onResize(()=>{app.resize();stage.resize();});
 const offHide=platform.onHide(()=>{hidden=true;}),offShow=platform.onShow(()=>{hidden=false;stage.resize();});
 void platform.loadFont?.('assets/fonts/jigsaw-ui-sc.'+(platform.config.id==='wechat'?'ttf':'woff2')).then(font=>{if(font){stage.font='"'+font+'", sans-serif';stage.invalidate();}});
 frame=platform.frame(draw);void app.start();
 return {app,client,stage,diagnostics:()=>({hidden,drawCount,dirty:stage.dirty,renderError:reported}),destroy(){alive=false;platform.cancelFrame(frame);offInput();offResize();offHide();offShow();app.destroy();}};
}
