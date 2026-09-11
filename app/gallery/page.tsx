import PuzzleApp from '../puzzle-app';
import AccountGate from '../account-gate';
import { PHOTOS } from '@/lib/puzzle-catalog';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/gallery');

export default async function Page({searchParams}:{searchParams:Promise<{mode?:string;resume?:string;image?:string}>}) {
 const {mode,resume,image}=await searchParams;
 const selected=PHOTOS.find(p=>p.id===image);
 const app=<PuzzleApp gallery initialQuery={selected?.title} entryMode={mode==='create'?'create':mode==='public'?'public':'solo'} guestPlay={mode!=='create'&&mode!=='public'&&mode!=='solo'}/>;
 return resume?<AccountGate requireLogin solo>{app}</AccountGate>:app;
}
