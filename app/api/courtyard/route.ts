import {requireAccount} from '@/lib/account-store';
import {body,json,failure} from '@/lib/room-store';
import {gardenFor,gardenAction,recoverGardenRewards} from '@/lib/courtyard-store';
export async function GET(request:Request){try{const user=await requireAccount(request);await recoverGardenRewards(user.id);return json(await gardenFor(user.id));}catch(e){return failure(e);}}
export async function POST(request:Request){try{const input=await body(request),user=await requireAccount(request);return json(await gardenAction(user.id,input));}catch(e){return failure(e);}}
