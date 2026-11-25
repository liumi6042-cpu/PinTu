import { redirect } from 'next/navigation';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/');
export default function Home() {
 redirect('/play');
}
