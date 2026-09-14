import PuzzleApp from '../puzzle-app';
import AccountGate from '../account-gate';
import { latestPublishedPhoto } from '@/lib/puzzle-catalog';
import { pageMetadata } from '@/lib/seo';
import { galleryEntry,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
export const metadata = pageMetadata('/gallery');

export default async function Page({searchParams}:{searchParams:Promise<{mode?:string;resume?:string;image?:string}>}) {
 const {mode,resume,image}=await searchParams;
 const selected=image?latestPublishedPhoto(image):undefined;
 const app=<PuzzleApp gallery initialQuery={selected?.title} {...galleryEntry(mode)}/>;
 return resume&&PERSONAL_PLAY_VISIBLE?<AccountGate requireLogin solo>{app}</AccountGate>:app;
}
