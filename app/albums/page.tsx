import AccountGate from '../account-gate';
import ManagedPlay from '../managed-play';
export const metadata={title:'Picture albums — Jigsaw Nook',robots:{index:false,follow:false}};
export default function Page(){return <AccountGate><ManagedPlay tab="albums"/></AccountGate>;}
