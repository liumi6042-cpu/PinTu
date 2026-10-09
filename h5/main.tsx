import { OrientationEffect } from './display-controls';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { LanguageProvider } from '../app/language-switch';
import AccountGate from '../app/account-gate';
import PublicLobby from '../app/public-lobby';
import DailyPuzzle from '../app/daily-puzzle';
import PuzzleApp from '../app/puzzle-app';
import RoomPlay from '../app/room-play';
import PersonalSpace from '../app/personal/personal-space';
import UserImages from '../app/personal/images/user-images';
import RecoverForm from '../app/account/recover/recover-form';
import SecurityCenter from '../app/account/security/security-center';
import AchievementAlbum from '../app/achievements/album';
import AdminCenter from '../app/admin/admin-center';
import FeedbackWidget from '../app/feedback-widget';
import { FeedbackPage as FeedbackCenter } from '../app/feedback-widget';
import ServiceDocument from '../app/service-document';
import PuzzleIntroduction from '../app/puzzle-introduction';
import { latestPublishedPhoto } from '../lib/puzzle-catalog';
import { galleryEntry } from '../lib/feature-visibility';
import { installNavigation,usePathname,currentSearch,navigate } from './navigation';
import '../app/globals.css';
import '../app/picture-discoveries.css';import '../app/puzzle-journey.css';
import '../app/community.css';import '../app/paper-theme.css';import '../app/paper-entrance.css';import '../app/language.css';
import '../app/lobby-grid.css';import '../app/gallery.css';import '../app/puzzle-opening.css';import '../app/table-theme.css';
import '../app/room-chat.css';import '../app/cosmetics.css';import '../app/achievements.css';import '../app/membership.css';
import '../app/ranking-records.css';import '../app/service-pages.css';import '../app/search-pages.css';import '../app/bookmark-site.css';
import './h5.css';
function Redirect({to}:{to:string}) {useEffect(()=>navigate(to,true),[to]);return null;}
function Page() {
  const path=usePathname(),search=currentSearch(),q=new URLSearchParams(search),zh=path==='/zh'||path.startsWith('/zh/'),plain=path.replace(/^\/zh(?=\/|$)/,'')||'/';
  useEffect(()=>{document.documentElement.lang=zh?'zh-CN':'en';},[zh]);
  if(plain==='/'||plain==='/taptap'||plain==='/leaderboard')return <Redirect to={zh?'/zh/lobby':'/lobby'}/>;
  if(plain==='/lobby')return <AccountGate><PublicLobby compact daily={<DailyPuzzle locale={zh?'zh':'en'} variant="quick"/>}/></AccountGate>;
  if(plain==='/gallery') {
    const photo=latestPublishedPhoto(q.get('image')||''),pieces=Number(q.get('pieces'));
    return <PuzzleApp key={path+search} gallery initialQuery={photo?.title} initialPieces={[108,300,500,1000].includes(pieces)?pieces:undefined} {...galleryEntry(q.get('mode')??undefined)}/>;
  }
  if(/^\/room\/[a-f0-9]{32}$/.test(path))return <AccountGate><RoomPlay key={path} roomId={path.split('/')[2]}/></AccountGate>;
  if(plain==='/personal'||plain==='/account')return <AccountGate requireLogin={plain==='/account'}><PersonalSpace/></AccountGate>;
  if(plain==='/personal/images')return <AccountGate><UserImages/></AccountGate>;
  if(plain==='/account/security')return <AccountGate requireLogin><SecurityCenter/></AccountGate>;
  if(plain==='/account/recover')return <AccountGate><RecoverForm/></AccountGate>;
  if(plain==='/achievements')return <AccountGate><AchievementAlbum/></AccountGate>;
  if(plain==='/admin')return <AccountGate requireLogin><AdminCenter/></AccountGate>;
  if(plain==='/feedback')return <AccountGate><FeedbackCenter/></AccountGate>;
  if(['/help','/terms','/privacy'].includes(plain))return <AccountGate><ServiceDocument kind={plain.slice(1) as 'help'|'terms'|'privacy'}/></AccountGate>;
  if(plain==='/membership'||plain==='/membership/manage')return <Redirect to={zh?'/zh/lobby':'/lobby'}/>;
  if(plain==='/courtyard'||plain==='/wardrobe')return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',fontSize:24}}>正在开发</main>;
  if(plain.startsWith('/puzzle/')){const photo=latestPublishedPhoto(plain.split('/')[2]);if(photo)return <PuzzleIntroduction photo={photo}/>;}
  return <main className="h5-route-error"><h1>{zh?'页面暂不可用':'Page unavailable'}</h1><a href={zh?'/zh/lobby':'/lobby'}>{zh?'返回大厅':'Back to lobby'}</a></main>;
}
function App(){const path=usePathname();return <LanguageProvider><OrientationEffect/><Page/>{path!=='/courtyard'&&<FeedbackWidget/>}</LanguageProvider>;}
installNavigation();
createRoot(document.getElementById('root')!).render(<App/>);
import './ad-integration';
