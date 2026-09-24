import AccountGate from '../account-gate';
import Wardrobe from './view';
export default function Page(){return <AccountGate requireLogin><Wardrobe/></AccountGate>;}
