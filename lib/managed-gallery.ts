import {readManagedContent,managedGalleryPhotos,effectiveManagedAlbums} from './managed-content';
export function managedGalleryEntry(now=Date.now()){
 const content=readManagedContent();
 return content?{catalogPhotos:managedGalleryPhotos(content,now),managedAlbums:effectiveManagedAlbums(content,now).map(({id,title,imageIds,purchasable,price})=>({id,title,imageIds,purchasable,price}))}:{};
}
