import coreAtlas from '../public/mobile-icons/b2-core-icons23.png';
import taskAtlas from '../public/mobile-icons/b2-task-icons23.png';

// Tight viewports around the original transparent artwork; never stretch these as UI borders.
import {coreBounds,taskBounds} from '../mobile/art-bounds';

export type ConceptArtKind=keyof typeof coreBounds|keyof typeof taskBounds;
export function conceptArt(kind:string){
 if(Object.prototype.hasOwnProperty.call(coreBounds,kind))return {bound:coreBounds[kind as keyof typeof coreBounds],source:coreAtlas,width:1254,height:1254};
 if(Object.prototype.hasOwnProperty.call(taskBounds,kind))return {bound:taskBounds[kind as keyof typeof taskBounds],source:taskAtlas,width:1774,height:887};
 return null;
}
