import { PHOTOS } from '@/lib/puzzle-catalog';
// Server-rendered Chinese copy so the text is in the HTML rather than appearing
// only after the client switches language. Mirrors the English search-introduction
// wording but links stay inside /zh.
export default function ChineseIntroduction({kind}:{kind:'home'|'lobby'|'gallery'|'help'}) {
  const heading = kind==='help' ? '在线拼图怎么玩、进度怎么保存。' : kind==='home' ? '在线拼图，按自己的节奏慢慢来。' : kind==='lobby' ? '和朋友一起拼，三步就能开始。' : '挑一张喜欢的画面，从 108 片到 1,000 片。';
  return <section className="search-introduction">
    <p className="section-kicker">JIGSAW NOOK</p>
    <h2>{heading}</h2>
    <div className="search-introduction-grid">
      <div><h3>选一张喜欢的图</h3><p>图库中有 {PHOTOS.length} 张原创画面，从安静的风景到温暖的生活片段。提供 108、300、500、1000 片四档选择，选好画面即可邀请朋友一起拼。</p><a href="/zh/gallery">浏览拼图图库 →</a></div>
      <div><h3>留个位置给朋友</h3><p>公开房间免费，每桌最多 8 人。任何片数都能直接加入；只有创建 500 片及以上房间需登录普通账号。分享邀请链接，就能和朋友拼同一张图。</p><a href="/zh/lobby">进入公开大厅 →</a></div>
      <div><h3>下次接着拼</h3><p>参与过的公开房间会出现在拼图记录中。已有进度的公开房间，在最后一位玩家离开后保留约 24 小时；使用原浏览器或账号即可回来继续。</p><a href="/zh/help">查看存档说明 →</a></div>
    </div>
  </section>;
}
