import AccountGate from '../account-gate';
import AdminCenter from './admin-center';
export default function Page(){return <AccountGate requireLogin><AdminCenter/></AccountGate>;}
