import AccountGate from '../../account-gate';
import SecurityCenter from './security-center';
export default function Page(){return <AccountGate requireLogin><SecurityCenter/></AccountGate>;}
