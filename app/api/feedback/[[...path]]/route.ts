import {env} from 'cloudflare:workers';
import {feedbackGateway,type FeedbackSettings} from '@/components/feedback/gateway';
const handle=(request:Request)=>feedbackGateway(request,env as unknown as FeedbackSettings,'puzzle',true);
export const GET=handle;
export const POST=handle;
