'use client';
import { t } from '@/lib/i18n';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { photoGuidance, recommendedPieces } from '@/lib/play-guidance';
import { maximumPieces } from '@/lib/piece-policy';
import { useLanguage } from './language-switch';
import { usePathname } from 'next/navigation';
import { hasChineseAddress,isChinesePath } from '@/lib/site-paths';
import HomeNavigation from './home-navigation';
import ServiceFooter from './service-footer';
export default function PuzzleIntroduction({photo}:{photo:typeof PHOTOS[number]}) {
  const pathname=usePathname()||'',en=hasChineseAddress(pathname)?!isChinesePath(pathname):useLanguage()==='en',guide=photoGuidance(photo.id),recommended=recommendedPieces(photo.id);
  const related=PHOTOS.filter(p=>p.id!==photo.id&&p.category===photo.category).slice(0,3);
  return <div className="puzzle-introduction-page">
    <header className="site-header"><a className="collection-brand-link" href="/">{t('一起拼图')}</a><HomeNavigation/></header>
    <main className="puzzle-introduction">
      <nav className="puzzle-breadcrumbs" aria-label={en?'Breadcrumb':'当前位置'}><a href="/">{en?'Home':'首页'}</a><span>/</span><a href="/gallery">{en?'Puzzle gallery':'图库'}</a><span>/</span><span>{t(photo.title)}</span></nav>
      <div className="puzzle-introduction-hero">
        <img src={photo.thumbSrc} alt={t(photo.title)+' — '+t(photo.subtitle)} width={480} height={Math.round(480*guide.height/guide.width)} decoding="async"/>
        <div><p className="section-kicker">{t(photo.category)}</p><h1>{t(photo.title)}{en?' Jigsaw Puzzle':'拼图'}</h1><p className="puzzle-introduction-subtitle">{t(photo.subtitle)}</p><p>{t(guide.reason)}</p><p>{en?`Start with ${recommended} pieces. This picture supports up to ${maximumPieces(photo.id).toLocaleString('en-US')} pieces.`:`推荐从 ${recommended} 片开始，这张图片最高支持 ${maximumPieces(photo.id).toLocaleString()} 片。`}</p>
          <div className="puzzle-introduction-actions"><a className="primary" href={'/gallery?mode=public&image='+photo.id}>{en?'Create a public puzzle':'创建公开拼图'} →</a><a className="secondary" href="/lobby">{en?'Join a table':'加入正在拼的房间'}</a></div>
        </div>
      </div>
      <section className="puzzle-introduction-guide"><h2>{en?'A few pieces to get you started':'从几片开始，慢慢找到节奏'}</h2><p>{en?'Find the corners and edges first, then group matching colors and shapes. Drag a piece close to its neighbor to connect it. Use the zoom controls for a closer look; connected pieces move together.':'先找四角与边缘，再按颜色和形状整理。把拼块拖到邻近位置即可吸附，放大后可以看得更清楚，已拼合的组合可以一起移动。'}</p><p>{en?'This is original AI-generated artwork created for Jigsaw Nook. Higher piece counts make each piece show a smaller part of the original image; zooming does not add new detail.':'这是为一起拼图生成的原创 AI 画面。片数越高，每片呈现的原图范围越小；放大不会增加原图中没有的细节。'}</p><a href="/help">{en?'How saving and multiplayer work':'查看存档和多人游玩说明'} →</a></section>
      {related.length>0&&<section className="puzzle-related"><h2>{en?'More pictures to piece together':'再看看这些画面'}</h2><div>{related.map(p=><a key={p.id} href={'/puzzle/'+p.id}><img src={p.thumbSrc} alt={t(p.title)} width={480} height={384} loading="lazy" decoding="async"/><span>{t(p.title)}</span></a>)}</div></section>}
    </main><ServiceFooter/>
  </div>;
}
