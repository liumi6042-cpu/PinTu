import type { Metadata } from 'next';
import './globals.css';
import './community.css';
import './paper-theme.css';
import './paper-entrance.css';
export const metadata: Metadata = { title: '一起拼图 · 和大家拼这一刻', description: '加入公开拼图桌面，或开启自己的拼图。一起完成，让这一刻留在用时榜上。' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN" className="paper-theme"><body>{children}</body></html>; }
