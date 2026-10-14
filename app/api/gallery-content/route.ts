import {readManagedContent,managedGalleryPhotos} from '@/lib/managed-content';
import {managedAccessibleImageIds} from '@/lib/managed-economy';
import {currentPlayer} from '@/lib/player-identity';
import {json,failure} from '@/lib/room-store';
export async function GET(request:Request){try{
 const content=readManagedContent(),now=Date.now(),photos=managedGalleryPhotos(content,now);
 if(!content)return json({enabled:false,photos,accessibleImageIds:photos.map(photo=>photo.id)});
 const player=await currentPlayer(request),allowed=await managedAccessibleImageIds(player?.id||'',content,now);
 return json({enabled:true,contentReleaseId:content.releaseId,photos,accessibleImageIds:[...allowed]});
}catch(error){return failure(error);}}
