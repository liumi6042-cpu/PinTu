import {json} from '@/lib/room-store';
import {sharedConfig,sharedRequestAllowed} from '@/lib/shared-client-model';
export function GET(request:Request){if(!sharedRequestAllowed(request))return json({error:'请从本网站打开'},403);return json(sharedConfig(new URL(request.url).origin));}
