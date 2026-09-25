import { COURTYARD_VISIBLE } from '@/lib/feature-visibility';
import AccountGate from '../account-gate';
import Courtyard from './view';
export default function Page(){return COURTYARD_VISIBLE?<AccountGate requireLogin><Courtyard/></AccountGate>:<main style={{minHeight:'100dvh',display:'grid',placeItems:'center',margin:0,fontSize:'24px'}}>正在开发</main>}
