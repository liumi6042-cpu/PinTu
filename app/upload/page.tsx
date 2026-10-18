import UploadPanel from '@/app/upload-panel';
import CommunityShell from '@/app/community-shell';
export const metadata = {title:'Play your own picture · Jigsaw Nook',robots:{index:false,follow:false}};
export default function Page(){
 return <CommunityShell active="personal"><main className="service-main">
  <h1>Start a table with your own picture</h1>
  <UploadPanel/>
 </main></CommunityShell>;
}
