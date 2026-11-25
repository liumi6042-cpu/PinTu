/** Merge validated delivered photo dimensions into the server's bundled guidance.
 * New daily images need the same resolution checks as bundled catalog images.
 * Only metadata is extended; saved puzzle grids and progress are never changed.
 */
export function mergeDeliveredGuidance(seed,photos){
 const result={...seed};
 for(const photo of photos??[]){
  if(typeof photo?.id!=='string'||!/^[a-z0-9-]+$/.test(photo.id)||!Number.isSafeInteger(photo.width)||photo.width<=0||!Number.isSafeInteger(photo.height)||photo.height<=0)continue;
  result[photo.id]={complexity:2,preferredCount:108,reason:'已交付图片实测尺寸',...result[photo.id],width:photo.width,height:photo.height};
 }
 return result;
}
