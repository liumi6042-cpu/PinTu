'use client';
import { useLanguage } from './language-switch';
import { PHOTOS } from '@/lib/puzzle-catalog';
export default function SearchIntroduction({kind}:{kind:'home'|'lobby'}) {
  const en = useLanguage() === 'en';
  return <section className="search-introduction">
    <p className="section-kicker">JIGSAW NOOK</p>
    <h2>{en ? kind === 'home' ? 'Free online jigsaw puzzles, at your own pace.' : 'How to play a jigsaw puzzle with friends' : kind === 'home' ? '在线拼图，按自己的节奏慢慢来。' : '和朋友一起拼，三步就能开始。'}</h2>
    <div className="search-introduction-grid">
      <div><h3>{en?'Choose your picture':'选一张喜欢的图'}</h3><p>{en?`Explore ${PHOTOS.length} original pictures, from quiet landscapes to colorful illustrations. Choose 108 to 2,000 pieces, with a suggested count for each picture.`:`图库中有 ${PHOTOS.length} 张原创画面，从安静的风景到彩色插画。可选 108–2,000 片，每张图都有推荐片数。`}</p><a href="/gallery">{en?'Browse jigsaw puzzles':'浏览拼图图库'} →</a></div>
      <div><h3>{en?'Make room for friends':'留个位置给朋友'}</h3><p>{en?'Join a public table or create one for free, with up to 8 players per room and no sign-in required. Share the invitation link and work on the same puzzle together.':'公开房间免费创建和加入，无需登录，每桌最多 8 人。分享邀请链接，就能和朋友拼同一张图。'}</p><a href={kind==='home'?'/lobby':'/gallery?mode=public'}>{en?kind==='home'?'Find a public table':'Create a public puzzle':kind==='home'?'进入公开大厅':'创建公开拼图'} →</a></div>
      <div><h3>{en?'Pick up where you left off':'下次接着拼'}</h3><p>{en?'Browser puzzles save on this device. Sign in with a free account for personal server puzzles. Public rooms with progress remain for about 24 hours after the last player leaves.':'本机拼图保存在当前浏览器；登录普通账号即可使用个人服务器拼图。已有进度的公开房间，在最后一位玩家离开后保留约 24 小时。'}</p><a href="/help">{en?'Read the play & save guide':'查看游玩与存档帮助'} →</a></div>
    </div>
  </section>;
}
