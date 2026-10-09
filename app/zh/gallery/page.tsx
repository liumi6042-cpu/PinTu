import PuzzleApp from '@/app/puzzle-app';
import AccountGate from '@/app/account-gate';
import { latestPublishedPhoto } from '@/lib/puzzle-catalog';
import { zhPageMetadata } from '@/lib/seo';
import { galleryEntry,PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
import ChineseIntroduction from '../chinese-introduction';
export const metadata = zhPageMetadata('/gallery');
export default async function Page({searchParams}:{searchParams:Promise<{mode?:string;resume?:string;image?:string;pieces?:string}>}) {
 const {mode,resume,image,pieces}=await searchParams;
 const selected=image?latestPublishedPhoto(image):undefined;
 const initialPieces=pieces&&[108,300,500,1000].includes(Number(pieces))?Number(pieces):undefined;
 const app=<PuzzleApp gallery initialQuery={selected?.title} initialPieces={initialPieces} {...galleryEntry(mode)}/>;
 return <>{resume&&PERSONAL_PLAY_VISIBLE?<AccountGate requireLogin solo>{app}</AccountGate>:app}<ChineseIntroduction kind="gallery"/></>;
}
