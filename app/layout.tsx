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
export const metadata: Metadata = { applicationName: 'Jigsaw Nook', metadataBase: new URL('https://jigsawnook.online'), title: 'Jigsaw Nook — Online Jigsaw Puzzles', description: 'Play online jigsaw puzzles at your own pace, or share a public table with friends.', robots: { index: false, follow: false }, icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en" className="paper-theme"><body><LanguageProvider>{children}<FeedbackWidget/></LanguageProvider></body></html>; }
