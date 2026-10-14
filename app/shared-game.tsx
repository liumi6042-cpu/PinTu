'use client';
import {useEffect,useState} from 'react';
import build from './shared-client-build.json';
import './shared-game.css';

type SharedHost=Window&{__JIGSAW_SHARED_CONFIG__?:Record<string,unknown>;__JIGSAW_SHARED__?:{destroy:()=>void}};
const NOTICE_VERSION='web-shared-test-2026-10-14';
export default function SharedGame(){
 const [error,setError]=useState(''),[notice,setNotice]=useState(false);
 useEffect(()=>{
  let active=true;const host=window as SharedHost,script=document.createElement('script');
  try{setNotice(localStorage.getItem(NOTICE_VERSION)!=='read');}catch{setNotice(true);}
  host.__JIGSAW_SHARED_CONFIG__={identityMode:'web-cookie',apiBase:location.origin+'/api/shared',assetBase:location.origin,gameBase:location.origin+'/play',uiBase:location.origin+build.uiBase,webLinks:{terms:'/terms',privacy:'/privacy',feedback:'/feedback'}};
  script.src=build.script;script.async=true;script.onerror=()=>{if(active)setError('游戏暂时未加载成功，请刷新重试。你的账号和进度仍保留。');};document.body.appendChild(script);
  return()=>{active=false;script.remove();host.__JIGSAW_SHARED__?.destroy();delete host.__JIGSAW_SHARED__;delete host.__JIGSAW_SHARED_CONFIG__;};
 },[]);
 function acknowledge(){try{localStorage.setItem(NOTICE_VERSION,'read');}catch{}setNotice(false);}
 return <main className="shared-game-host" aria-label="拼图小窝测试版"><canvas id="game" aria-label="拼图游戏画面"/>
  {error&&<section className="shared-game-notice" role="alert"><div><h1>暂时无法打开</h1><p>{error}</p><button type="button" onClick={()=>window.location.reload()}>重新加载</button><a className="shared-notice-link" href="/feedback" target="_blank" rel="noopener">反馈问题</a></div></section>}
  {notice&&!error&&<section className="shared-game-notice" role="dialog" aria-modal="true" aria-labelledby="shared-test-title"><div><span className="shared-test-label">测试版</span><h1 id="shared-test-title">欢迎体验新的拼图小窝</h1><p>新界面与小程序共用一套功能。你的 Web 账号、已获得的物品和原有拼图进度继续保留；Web 不使用体力。</p><p>测试期间可能出现故障，功能与奖励规则可能调整。影响已有权益的重要变更会另行说明，测试身份不影响你的法定权利。</p><p>请查看<a href="/terms" target="_blank" rel="noopener">服务协议</a>和<a href="/privacy" target="_blank" rel="noopener">隐私说明</a>。遇到问题可通过<a href="/feedback" target="_blank" rel="noopener">意见反馈</a>联系我们。</p><button type="button" onClick={acknowledge}>知道了，开始体验</button></div></section>}
  <noscript>请启用 JavaScript 来玩拼图，或<a href="/help">查看帮助</a>。</noscript>
 </main>;
}
