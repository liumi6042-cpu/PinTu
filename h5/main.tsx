import { MobileRuntimeGate } from './mobile-runtime';
import { OrientationEffect } from './display-controls';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { applyDetectedLanguage,getLanguageRevision } from '../lib/i18n';
import AccountGate from '../app/account-gate';
import RoomPlay from '../app/room-play';
import { MobileGallery, MobileLobby, MobileSupplies } from './mobile-app';
import { MobileStatus } from './mobile-status';
import { MobileCollection } from './mobile-collection';
import { MobileInvitationBridge } from './mobile-invitations';
import { MobileProvider,useMobilePlayer } from './mobile-state';
import {contributionCopy,recoveryCopy} from '../mobile/economy-copy';
import { MobilePageHeading } from './mobile-shared';
import { installNavigation,usePathname,navigate } from './navigation';
import '../app/globals.css';
import '../app/picture-discoveries.css';import '../app/puzzle-journey.css';
import '../app/community.css';import '../app/paper-theme.css';import '../app/paper-entrance.css';import '../app/language.css';
import '../app/lobby-grid.css';import '../app/gallery.css';import '../app/puzzle-opening.css';import '../app/table-theme.css';
import '../app/room-chat.css';import '../app/cosmetics.css';import '../app/achievements.css';import '../app/membership.css';
import '../app/ranking-records.css';import '../app/service-pages.css';import '../app/search-pages.css';import '../app/bookmark-site.css';
import './h5.css';
import './mobile.css';
import './mobile-game.css';
import './mobile-typography.css';
import './mobile-b2.css';
import './pixel-ui.css';
import './mobile-concept20.css';
import './mobile-supplies-concept20.css';
import './mobile-meters21.css';

function Redirect({to}:{to:string}) {useEffect(()=>navigate(to,true),[to]);return null;}
function MobileDocument({kind}:{kind:string}){const {profile}=useMobilePlayer();return <main className="mobile-app"><MobilePageHeading title={kind==='privacy'?'隐私说明':kind==='terms'?'游玩约定':'玩法帮助'}/><section className="mobile-policy">{kind==='privacy'?<><p>TapTap手机版使用独立的玩家凭证、房间、聊天、成长及补给库存，不与PC网站共享游玩数据。</p><p>服务器保存必要的昵称、拼图进度、有效贡献、邀请关系、奖励和库存流水。昵称与等级向同房玩家展示，请勿填写个人隐私。</p><p>本机凭证用于恢复当前游客身份。清除客户端数据、换设备可能无法找回原身份和库存。</p><p>TapTap在你主动选择后提供激励广告。我们保存一次性领奖请求及发放结果以避免重复领取。</p><a href="https://www.taptap.cn/doc/privacy-policy" target="_blank" rel="noopener noreferrer">TapTap隐私政策</a></>:kind==='terms'?<><p>本版本没有会员或付费购买入口。随机创建公开房间免费，已购图包内的图片可免费创建公开房间，其他指定图片或私人房间需要建房券。</p><p>请尊重同房玩家，不使用侮辱性昵称、不用脚本抢块或干扰服务。游戏奖励仅用于本游戏，无现金价值。</p><p>图库使用已登记来源的图片。游玩不授予图片转售或其他商业使用权。</p></>:<><p>拖动拼块并靠近正确位置松开。双指缩放和平移，“适配”可以找回完整桌面。</p><p>{contributionCopy(profile)}</p><p>分享邀请可获得奖励，具体数值和每日次数可在任务入口查看。通过邀请链接或邀请码确认好友关系，受邀者完成3次有效拼合后，邀请者另获得补满体力包，每日最多奖励3位好友。礼包可留待需要时开启，补满包在体力已满时不会被消耗。</p><p>{recoveryCopy(profile)}也可以在补给站主动看广告预存体力包和建房券。</p><p>同时最多保留3个未结束的自建房间。随机公开房免费，已购图包公开建房免费；其他指定图片或私人房只消耗1张建房券。</p></>}</section></main>;}
function Page() {
 const path=usePathname(),plain=path.replace(/^\/zh(?=\/|$)/,'')||'/';
 useEffect(()=>{document.documentElement.lang='zh-CN';},[path]);
 if(plain==='/lobby')return <MobileLobby/>;
 if(plain==='/gallery')return <MobileGallery/>;
 if(plain==='/supplies')return <MobileSupplies/>;
 if(plain==='/collection')return <MobileCollection/>;
 if(/^\/room\/[a-f0-9]{32}$/.test(path))return <AccountGate><RoomPlay key={path} roomId={path.split('/')[2]} mobile mobileStatus={<MobileStatus compact game/>} onSupplies={()=>navigate('/zh/supplies?returnTo='+encodeURIComponent(path))}/></AccountGate>;
 if(['/help','/privacy','/terms'].includes(plain))return <MobileDocument kind={plain.slice(1)}/>;
 return <Redirect to="/zh/lobby"/>;
}
function App(){return <MobileRuntimeGate><MobileProvider><OrientationEffect/><Page/><MobileInvitationBridge/></MobileProvider></MobileRuntimeGate>;}
// This mobile release uses Chinese without altering the PC site's stored language preference.
applyDetectedLanguage('zh',getLanguageRevision());
installNavigation();
createRoot(document.getElementById('root')!).render(<App/>);
