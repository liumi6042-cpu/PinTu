import { managedDailyPuzzle, readManagedContent } from '@/lib/managed-content';
import { englishCopy } from '@/lib/seo';
import LanguageSwitch from './language-switch';
import StartDaily from './web-start-daily';
import './web-home.css';

function today() {
  try {
    return managedDailyPuzzle(readManagedContent());
  } catch {
    return null;
  }
}

export default function WebHome({ locale }: { locale: 'en' | 'zh' }) {
  const zh = locale === 'zh';
  const photo = today();
  const title = photo && (zh ? photo.title : englishCopy(photo.title));
  const titleLanguage = !zh && title === photo?.title && /\p{Script=Han}/u.test(title ?? '') ? 'zh-CN' : undefined;

  return <main className="web-home">
    <header className="web-home-header">
      <a className="web-home-brand" href={zh ? '/zh' : '/'}>{zh ? '拼图小窝' : 'Jigsaw Nook'}</a>
      <LanguageSwitch />
    </header>

    <section className={`web-home-hero${photo ? '' : ' web-home-hero-empty'}`}>
      <div className="web-home-intro">
        <h1>{zh ? '今天，拼一幅画。' : 'A little time for a puzzle.'}</h1>
        <p>{zh ? '每天换一幅图。打开浏览器就能免费拼，也可以把房间链接发给朋友一起玩。' : 'Play free online jigsaw puzzles in your browser. Try the picture of the day or share a table with friends.'}</p>
        {photo ? <>
          <div className="web-home-daily">
            <span>{zh ? '今日拼图' : 'Puzzle of the day'}</span>
            <h2 lang={titleLanguage}>{title}</h2>
          </div>
          <StartDaily zh={zh} />
        </> : <p role="status">{zh ? '今日拼图暂时无法显示，你仍可进入游戏。' : 'Today’s picture is temporarily unavailable. You can still open the game.'}</p>}
        <a className={photo ? 'web-home-game-link' : 'web-home-start'} href="/play">
          {zh ? '进入游戏' : 'Open the game'} <span aria-hidden="true">→</span>
        </a>
      </div>

      {photo && <figure className="web-home-art">
        <img src={photo.thumbSrc} alt={title ?? ''} lang={titleLanguage} width={photo.width} height={photo.height} fetchPriority="high" />
      </figure>}
    </section>

    <footer className="web-home-footer">
      <a href={zh ? '/zh/help' : '/help'}>{zh ? '玩法帮助' : 'How to play'}</a>
      <a href="/terms">{zh ? '服务协议' : 'Terms'}</a>
      <a href="/privacy">{zh ? '隐私说明' : 'Privacy'}</a>
    </footer>
  </main>;
}
