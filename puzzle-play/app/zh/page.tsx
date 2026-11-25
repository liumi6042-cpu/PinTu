import { zhPageMetadata } from '@/lib/seo';
import WebHome from '../web-home';

export const metadata = zhPageMetadata('/');

export default function Page() {
  return <WebHome locale="zh" />;
}
