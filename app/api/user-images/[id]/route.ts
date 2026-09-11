import { currentAccount,requireAccount } from '@/lib/account-store';
import { currentGuest } from '@/lib/player-identity';
import { body,failure,json } from '@/lib/room-store';
import { RoomError } from '@/lib/room-engine';
import { canReadUserImage,removeUserImage,userImageBytes } from '@/lib/user-image-store';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){try{
 const {id}=await context.params,url=new URL(request.url),[account,guest]=await Promise.all([currentAccount(request),currentGuest(request)]);
 const owners=new Set([account?.id,guest?.id].filter((id):id is string=>!!id));
 if(!await canReadUserImage(id,owners,url.searchParams.get('room')))throw new RoomError('图片不存在或无权查看',404);
 const bytes=await userImageBytes(id,url.searchParams.get('preview')==='1');
 return new Response(bytes,{headers:{'Content-Type':'image/webp','Content-Length':String(bytes.byteLength),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
}catch(e){return failure(e);}}
export async function POST(request:Request,context:Context){try{
 const input=await body(request);if(input.action!=='delete')throw new RoomError('操作无效');const account=await requireAccount(request),{id}=await context.params;
 await removeUserImage(account.id,id);return json({deleted:true});
}catch(e){return failure(e);}}
