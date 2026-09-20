import AccountGate from '@/app/account-gate';
import ServiceDocument from '@/app/service-document';
import { zhPageMetadata } from '@/lib/seo';
import ChineseIntroduction from '../chinese-introduction';
export const metadata = zhPageMetadata('/help');
export default function Page(){return <><AccountGate><ServiceDocument kind="help"/></AccountGate><ChineseIntroduction kind="help"/></>;}
