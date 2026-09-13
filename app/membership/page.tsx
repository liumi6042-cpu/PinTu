import AccountGate from '../account-gate';
import MembershipBenefits from './benefits';
import { redirect } from 'next/navigation';
import { MEMBERSHIP_VISIBLE } from '@/lib/feature-visibility';
export default function Page(){if(!MEMBERSHIP_VISIBLE)redirect('/lobby');return <AccountGate><MembershipBenefits/></AccountGate>;}
