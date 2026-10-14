import { redirect } from 'next/navigation';
import { zhPageMetadata } from '@/lib/seo';
export const metadata = zhPageMetadata('/');
export default function Page() {
  redirect('/play');
}
