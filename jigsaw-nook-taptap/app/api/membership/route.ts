import { currentAccount } from '@/lib/account-store';
import { membershipOrders,membershipSummary } from '@/lib/membership-store';
import { failure,json } from '@/lib/room-store';
export async function GET(request:Request){try{
  const account=await currentAccount(request);return json({summary:await membershipSummary(account?.id),orders:account?await membershipOrders(account.id):[]});
}catch(error){return failure(error);}}
