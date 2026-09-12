import type { Metadata } from 'next';
import './globals.css';
import './community.css';
import './paper-theme.css';
import './paper-entrance.css';
import './language.css';
import './lobby-grid.css';
import './gallery.css';
import './table-theme.css';
import './achievements.css';
import './membership.css';
import './ranking-records.css';
import './service-pages.css';
import './search-pages.css';
import { LanguageProvider } from './language-switch';
import FeedbackWidget from './feedback-widget';
export const metadata: Metadata = {
  applicationName: 'Jigsaw Nook',
  metadataBase: new URL('https://jigsawnook.online'),
  title: 'Jigsaw Nook — Online Jigsaw Puzzles',
  description: 'Play online jigsaw puzzles at your own pace, or share a public table with friends.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/favicon.ico?v=paper-arch-1', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: '/favicon-96.png?v=paper-arch-1', sizes: '96x96', type: 'image/png' },
      { url: '/favicon.svg?v=paper-arch-1', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: { url: '/apple-touch-icon.png?v=paper-arch-1', sizes: '180x180', type: 'image/png' },
  },
};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className="paper-theme"><body><LanguageProvider>{children}<FeedbackWidget/></LanguageProvider></body></html>; }
