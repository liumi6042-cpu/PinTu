import type {CollectionAlbum,CollectionDecoration} from '../h5/mobile-collection-api';

export function collectionDecorationRewardHints(decoration:CollectionDecoration,albums:CollectionAlbum[]):string[]{
 const rewards=decoration.rewardAlbums??albums.flatMap(album=>album.milestones.filter(milestone=>milestone.decorationId===decoration.id).map(milestone=>({id:album.id,title:album.title,target:milestone.target})));
 return rewards.map(album=>'收集「'+album.title+'」'+album.target+' 张可获得');
}
