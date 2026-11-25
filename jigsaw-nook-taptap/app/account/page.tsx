import AccountGate from '../account-gate';
import PersonalSpace from '../personal/personal-space';
export default function AccountPage(){return <AccountGate requireLogin><PersonalSpace/></AccountGate>;}
