import AccountGate from '../account-gate';
import ServiceDocument from '../service-document';
import { pageMetadata } from '@/lib/seo';
export const metadata = pageMetadata('/help');
export default function Page(){return <AccountGate><ServiceDocument kind="help"/></AccountGate>;}
