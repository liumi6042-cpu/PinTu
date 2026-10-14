import AccountGate from '@/app/account-gate';
import ManagedPlay from '@/app/managed-play';
export const metadata={title:'任务与奖励 · 一起拼图',robots:{index:false,follow:false}};
export default function Page(){return <AccountGate><ManagedPlay tab="tasks"/></AccountGate>;}
