import ForceChinese from './force-chinese';
// The root layout owns <html>, so the language of these pages is declared with
// content-language and by ForceChinese rewriting documentElement.lang once the
// page runs. Everything a crawler reads without JavaScript — title, description,
// headings, body copy, hreflang and structured data — is already Chinese here.
export default function ChineseLayout({children}:{children:React.ReactNode}) {
  return <><meta httpEquiv="content-language" content="zh-CN"/><ForceChinese/>{children}</>;
}
