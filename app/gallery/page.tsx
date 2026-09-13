import PuzzleApp from '../puzzle-app';
import AccountGate from '../account-gate';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { pageMetadata } from '@/lib/seo';
import { galleryEntry,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
export const metadata = pageMetadata('/gallery');

export default async function Page({searchParams}:{searchParams:Promise<{mode?:string;resume?:string;image?:string}>}) {
 const {mode,resume,image}=await searchParams;
 const selected=PHOTOS.find(p=>p.id===image||'replaces' in p&&p.replaces===image);
 const app=<PuzzleApp gallery initialQuery={selected?.title} {...galleryEntry(mode)}/>;
 return resume&&PERSONAL_PLAY_VISIBLE?<AccountGate requireLogin solo>{app}</AccountGate>:app;
}
