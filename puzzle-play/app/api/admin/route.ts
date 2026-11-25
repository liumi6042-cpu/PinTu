import { adminOverview,adminAction } from '@/lib/admin-store';
import { body,json,failure } from '@/lib/room-store';
export async function GET(request:Request){try{return json(await adminOverview(request));}catch(error){return failure(error);}}
export async function POST(request:Request){try{return json(await adminAction(request,await body(request)));}catch(error){return failure(error);}}
