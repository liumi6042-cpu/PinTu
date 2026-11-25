import HomeNavigation from '@/app/home-navigation';
// Server-rendered so the Chinese header text is present in the HTML a crawler
// reads, rather than appearing only after the client switches language.
export default function ChineseNavigation() {
  return <header className="site-header">
    <a className="collection-brand-link" href="/zh">一起拼图</a>
    <HomeNavigation/>
  </header>;
}
