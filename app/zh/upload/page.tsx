import UploadRoom from '@/app/upload-room';
import AccountGate from '@/app/account-gate';
export const metadata = {title:'用一张图片开一桌 · 一起拼图',robots:{index:false,follow:false}};
export default function Page(){
 return <AccountGate requireLogin><UploadRoom/></AccountGate>;
}
