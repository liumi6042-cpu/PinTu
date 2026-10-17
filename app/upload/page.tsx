import UploadRoom from '@/app/upload-room';
import AccountGate from '@/app/account-gate';
export const metadata = {title:'Play your own picture · Jigsaw Nook',robots:{index:false,follow:false}};
export default function Page(){
 return <AccountGate requireLogin><UploadRoom/></AccountGate>;
}
