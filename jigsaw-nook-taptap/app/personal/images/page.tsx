import AccountGate from '../../account-gate';
import UserImages from './user-images';
import { redirect } from 'next/navigation';
import { USER_IMAGE_UPLOAD_VISIBLE } from '@/lib/feature-visibility';
export default function Page(){if(!USER_IMAGE_UPLOAD_VISIBLE)redirect('/personal');return <AccountGate><UserImages/></AccountGate>;}
