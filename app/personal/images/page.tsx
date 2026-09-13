import AccountGate from '../../account-gate';
import UserImages from './user-images';
import { redirect } from 'next/navigation';
import { PERSONAL_PLAY_VISIBLE } from '@/lib/feature-visibility';
export default function Page(){if(!PERSONAL_PLAY_VISIBLE)redirect('/personal');return <AccountGate><UserImages/></AccountGate>;}
