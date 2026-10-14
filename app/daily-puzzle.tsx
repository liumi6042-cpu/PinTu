import DailyJoin from './daily-join';
import { dailyPuzzleDate } from '@/lib/daily-puzzle';
import {managedDailyPuzzle,readManagedContent} from '@/lib/managed-content';
import { recommendedPieces } from '@/lib/play-guidance';
import { maximumPieces } from '@/lib/piece-policy';
import { englishCopy } from '@/lib/seo';

// Rendered on the server so the day's picture is in the HTML a crawler reads, and
// so two visitors on the same day can never be shown different pictures.
//
// `strip` is the lobby's version of the same pick: the lobby is a list of tables, and
// the full card there would push the tables people came for below the fold.
export default function DailyPuzzle({locale,variant='full'}:{locale:'zh'|'en';variant?:'full'|'strip'}) {
  const zh=locale==='zh',now=Date.now();
  let photo;
  try{photo=managedDailyPuzzle(readManagedContent(),now);}catch{return <section className="daily-puzzle daily-puzzle-strip"><p className="section-kicker">{zh?'今日拼图':'PUZZLE OF THE DAY'}</p><p role="status">{zh?'今日图片正在准备，请稍后再来。':'Today’s picture is being prepared. Please check again shortly.'}</p></section>;}
  const title=zh?photo.title:englishCopy(photo.title),subtitle=zh?photo.subtitle:englishCopy(photo.subtitle);
  const recommended=recommendedPieces(photo.id),maximum=maximumPieces(photo.id);
  const note=zh?`${dailyPuzzleDate(now)} · 每天零点（北京时间）换一张，全站同一张。`:`${dailyPuzzleDate(now)} · A new picture each day at midnight Beijing time, the same for every visitor.`;
  if(variant==='strip')return <section className="daily-puzzle daily-puzzle-strip" aria-labelledby="daily-puzzle-heading">
    <p className="section-kicker">{zh?'今日拼图':'PUZZLE OF THE DAY'}</p>
    <div className="daily-puzzle-strip-row">
      <div className="daily-puzzle-strip-copy">
        <h2 id="daily-puzzle-heading">{title}</h2>
        <p>{subtitle}</p>
      </div>
      <DailyJoin zh={zh} photo={photo} title={title} compact showImage/>
    </div>
    <p className="daily-puzzle-note">{note}</p>
  </section>;
  return <section className="daily-puzzle" aria-labelledby="daily-puzzle-heading">
    <p className="section-kicker">{zh?'今日拼图':'PUZZLE OF THE DAY'}</p>
    <h2 id="daily-puzzle-heading">{zh?'今天，就拼这一幅':'One picture, picked for today'}</h2>
    <div className="daily-puzzle-card">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
        <p>{zh?`建议从 ${recommended} 片开始，这张图最高支持 ${maximum.toLocaleString('zh-CN')} 片。`:`Start with ${recommended} pieces. This picture supports up to ${maximum.toLocaleString('en-US')}.`}</p>
        <DailyJoin zh={zh} photo={photo} title={title} showImage/>
      </div>
    </div>
    <p className="daily-puzzle-note">{note}</p>
  </section>;
}
