import AccountGate from '@/app/account-gate';
import ServiceDocument from '@/app/service-document';
import UploadPanel from '@/app/upload-panel';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/help');
export default function Page(){return <AccountGate><ServiceDocument kind="help" extra={<UploadPanel/>}/></AccountGate>;}
