import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '一起拼图 · 慢慢拼，好好玩', description: '挑一张喜欢的图，享受拖拽、吸附与一片片完成的快乐。单人拼图试玩。' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="zh-CN" className="dark"><body>{children}</body></html>; }
