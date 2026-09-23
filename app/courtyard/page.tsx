import AccountGate from '../account-gate';
import Courtyard from './view';
export default function Page(){return <AccountGate requireLogin><Courtyard/></AccountGate>}
