import { pageMetadata } from '@/lib/seo';
import WebHome from './web-home';

export const metadata = pageMetadata('/');

export default function Home() {
  return <WebHome locale="en" />;
}
