import PuzzleApp from '../puzzle-app';

export default async function Page({searchParams}:{searchParams:Promise<{mode?:string}>}) {
 const {mode}=await searchParams;
 return <PuzzleApp gallery entryMode={mode==='create'?'create':'solo'} guestPlay={mode!=='create'&&mode!=='solo'}/>;
}
