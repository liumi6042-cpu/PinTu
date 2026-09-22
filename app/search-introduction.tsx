'use client';
import { useLanguage } from './language-switch';
import { usePathname } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import { PHOTOS } from '@/lib/puzzle-catalog';
// Chinese pages carry their own server-rendered copy, so this section stands down
// there rather than printing the same three blocks twice (see ChineseIntroduction).
export default function SearchIntroduction({kind}:{kind:'home'|'lobby'}) {
  // This section only renders on the English address (the Chinese pages carry their own copy),
  // so its wording is English whatever language the visitor reads.
  const en = !isChinesePath(usePathname() || '');
  if (isChinesePath(usePathname() || '')) return null;
  return <section className="search-introduction">
    <p className="section-kicker">JIGSAW NOOK</p>
    <h2>{en ? kind === 'home' ? 'Free online jigsaw puzzles, at your own pace.' : 'How to play a jigsaw puzzle with friends' : kind === 'home' ? '在线拼图，按自己的节奏慢慢来。' : '和朋友一起拼，三步就能开始。'}</h2>
    <div className="search-introduction-grid">
      <div><h3>{en?'Choose your picture':'选一张喜欢的图'}</h3><p>{en?`Explore ${PHOTOS.length} original pictures, from quiet landscapes to warm everyday scenes. Choose 108, 300, 500 or 1,000 pieces, then invite friends to play.`:`图库中有 ${PHOTOS.length} 张原创画面，从安静的风景到温暖的生活片段。提供 108、300、500、1000 片四档选择，选好画面即可邀请朋友一起拼。`}</p><a href="/gallery">{en?'Browse jigsaw puzzles':'浏览拼图图库'} →</a></div>
      <div><h3>{en?'Make room for friends':'留个位置给朋友'}</h3><p>{en?'Public puzzles are free, with up to 8 players per room. Join a table of any piece count as a guest; only creating a room with 500 pieces or more requires a free account. Share the invitation link and play together.':'公开房间免费，每桌最多 8 人。任何片数都能直接加入；只有创建 500 片及以上房间需登录普通账号。分享邀请链接，就能和朋友拼同一张图。'}</p><a href={kind==='home'?'/lobby':'/gallery?mode=public'}>{en?kind==='home'?'Find a public table':'Create a public puzzle':kind==='home'?'进入公开大厅':'创建公开拼图'} →</a></div>
      <div><h3>{en?'Pick up where you left off':'下次接着拼'}</h3><p>{en?'Your public tables appear in My puzzles. A public room is kept for up to 24 hours from the moment it is created, and playing again does not extend that. Use the same browser or account to return.':'参与过的公开房间会出现在拼图记录中。公开房间从创建起最多保留 24 小时，中途继续拼也不会延长；使用原浏览器或账号即可回来继续。'}</p><a href="/personal">{en?'My puzzles':'查看拼图记录'} →</a></div>
    </div>
  </section>;
}
