import UploadPanel from '@/app/upload-panel';
import CommunityShell from '@/app/community-shell';
export const metadata = {title:'用一张图片开一桌 · 一起拼图',robots:{index:false,follow:false}};
export default function Page(){
 return <CommunityShell active="personal"><main className="service-main">
  <h1>用我的图片开一桌</h1>
  <UploadPanel/>
 </main></CommunityShell>;
}
