import AccountGate from '../account-gate';
import SecurityCenter from './security/security-center';
export default function AccountPage(){return <AccountGate requireLogin><SecurityCenter/></AccountGate>;}
