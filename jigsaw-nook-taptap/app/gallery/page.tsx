import PuzzleApp from '../puzzle-app';
import AccountGate from '../account-gate';
import { latestPublishedPhoto } from '@/lib/puzzle-catalog';
import { pageMetadata } from '@/lib/seo';
import { galleryEntry,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
export const metadata = pageMetadata('/gallery');

export default async function Page({searchParams}:{searchParams:Promise<{mode?:string;resume?:string;image?:string;pieces?:string}>}) {
 const {mode,resume,image,pieces}=await searchParams;
 const selected=image?latestPublishedPhoto(image):undefined;
 const initialPieces=pieces&&[108,300,500,1000].includes(Number(pieces))?Number(pieces):undefined;
 const app=<PuzzleApp gallery initialQuery={selected?.title} initialPieces={initialPieces} {...galleryEntry(mode)}/>;
 return resume&&PERSONAL_PLAY_VISIBLE?<AccountGate requireLogin solo>{app}</AccountGate>:app;
}
