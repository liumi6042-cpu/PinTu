import { publicSettings } from '@/lib/site-settings';
import { json } from '@/lib/room-store';
export function GET(){return json(publicSettings());}
