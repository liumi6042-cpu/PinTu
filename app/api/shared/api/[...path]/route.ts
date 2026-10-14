import {sharedClientApi} from '@/lib/shared-client-api';
type Context={params:Promise<{path:string[]}>};
async function dispatch(request:Request,context:Context){const {path}=await context.params;return sharedClientApi(request,'/api/'+path.join('/'));}
export const GET=dispatch;
export const POST=dispatch;
export const PATCH=dispatch;
export const DELETE=dispatch;
