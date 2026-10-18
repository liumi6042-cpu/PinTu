import AccountGate from '@/app/account-gate';
import ServiceDocument from '@/app/service-document';
import UploadPanel from '@/app/upload-panel';
import { zhPageMetadata } from '@/lib/seo';
import ChineseIntroduction from '../chinese-introduction';
export const metadata = zhPageMetadata('/help');
export default function Page(){return <><AccountGate><ServiceDocument kind="help" extra={<UploadPanel/>}/></AccountGate><ChineseIntroduction kind="help"/></>;}
