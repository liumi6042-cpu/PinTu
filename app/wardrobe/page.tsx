import AccountGate from '../account-gate';
import Wardrobe from './view';
import { WARDROBE_VISIBLE } from '@/lib/feature-visibility';
export default function Page(){return WARDROBE_VISIBLE?<AccountGate requireLogin><Wardrobe/></AccountGate>:<main style={{minHeight:'100dvh',display:'grid',placeItems:'center',margin:0,fontSize:'24px'}}>正在开发</main>}
