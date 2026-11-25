import AccountGate from '../../account-gate';
import MembershipCenter from './center';
import { redirect } from 'next/navigation';
import { MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';
export default function Page(){if(!MEMBERSHIP_VISIBLE)redirect('/personal');return <AccountGate><MembershipCenter/></AccountGate>;}
