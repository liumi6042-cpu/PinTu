import type { ReactNode } from 'react';
import atlas from '../public/mobile-icons/b2-pixel-atlas.png';
import faithfulAtlas from '../public/mobile-icons/b2-faithful-atlas.png';
import supplyScenes from '../public/mobile-icons/b2-supply-scenes.png';
import './mobile-icons.css';
import {pixelDetails} from './mobile-pixel-details';
import {conceptSymbols} from './mobile-concept-symbols';
import {conceptArt,type ConceptArtKind} from './mobile-concept-art';

const illustrations={
 avatar:[42,70,283,255],gift:[381,90,217,230],store:[655,109,240,214],ticket:[958,110,258,207],
 energy:[80,380,188,247],lightning:[407,394,171,228],coin:[675,408,234,210],fragment:[990,394,219,222],
 book:[38,682,293,232],leaf:[398,690,192,215],flower:[676,685,227,220],bow:[971,676,241,226],
 butterfly:[71,950,233,246],feather:[398,951,191,237],moon:[679,955,209,243],lantern:[988,937,188,269],
} as const;

const faithful={
 avatar:[31,56,285,242],gift:[383,57,203,238],store:[646,82,269,208],book:[983,82,235,210],
 lightning:[103,354,145,232],ticket:[338,368,282,228],sprig:[693,388,192,192],energy:[976,346,246,258],
 invitationArt:[31,667,280,241],friendArt:[344,649,276,265],cooperationArt:[662,667,247,248],pouch:[963,667,255,242],
 xpChest:[38,964,275,240],goldGift:[369,963,238,240],refillGift:[693,958,218,248],xpStar:[995,984,194,190],
} as const;
const scenes={supplyEnergy:[0,0,887,887],supplyTicket:[887,0,887,887]} as const;

type PixelSymbol='piece'|'players'|'help'|'edge'|'fit'|'hint'|'underlay'|'tools'|'shuffle'|'create'|'star'|'daily'|'back'|'person'|'invite'|'filter'|'video'|'bag'|'giftFlat'|keyof typeof pixelDetails|keyof typeof conceptSymbols;
export type MobileArtKind=keyof typeof illustrations|keyof typeof faithful|keyof typeof scenes|PixelSymbol|ConceptArtKind;
const symbols:Record<PixelSymbol,ReactNode>={

 hint:<><path d="M8 1h8v2h3v3h2v8h-3v3h-2v5H8v-5H6v-3H3V6h2V3h3z" fill="var(--b2-gold,#d3a558)"/><path d="M9 18h6v2H9zM10 22h4v2h-4z" fill="currentColor"/><path d="M8 5h3v2H8v4H6V7h2z" fill="#fff5de"/></>,
 help:<><path d="M6 1h12v2h3v3h2v12h-2v3h-3v2H6v-2H3v-3H1V6h2V3h3z" fill="var(--b2-paper,#fff5e8)"/><path d="M7 5h10v2h2v5h-4v3h-4v-5h4V8H9v2H6V7h1zM11 18h4v3h-4z"/></>,
 shuffle:<><path d="M1 5h6v2h3v3h3v3h3v3h3v-3h3v8h-8v-3h3v-1h-3v-2h-3v-3H8V9H5V8H1z"/><path d="M14 3h8v8h-3V8h-3v2h-3V7h3V6h-2zM1 17h4v-2h3v-2h3v3H8v3H5v1H1z"/></>,
 ...pixelDetails,
 ...conceptSymbols,
};
export function MobileArt({kind,className=''}:{kind:MobileArtKind;className?:string}){
 const concept=conceptArt(kind);
 const scene=Object.prototype.hasOwnProperty.call(scenes,kind)?scenes[kind as keyof typeof scenes]:null;
 const faithfulBound=Object.prototype.hasOwnProperty.call(faithful,kind)?faithful[kind as keyof typeof faithful]:null;
 const native=Object.prototype.hasOwnProperty.call(pixelDetails,kind);
 // Concept illustrations remain separate from stretchable UI frame sprites.
 const originalBound=Object.prototype.hasOwnProperty.call(illustrations,kind)?illustrations[kind as keyof typeof illustrations]:null;
 const bound=concept?.bound??(native?null:scene??originalBound??faithfulBound);
 const source=concept?.source??(scene?supplyScenes:originalBound?atlas:faithfulAtlas);
 const sourceWidth=concept?.width??(scene?1774:1254),sourceHeight=concept?.height??(scene?887:1254);
 return <span className={'mobile-art mobile-art-'+kind+(className?' '+className:'')} aria-hidden="true" data-art-kind={kind} data-art-source={concept?'concept23':undefined}>
 {bound?<svg className="mobile-art-svg mobile-art-illustration" viewBox={bound.join(' ')} preserveAspectRatio={scene?'xMidYMid slice':'xMidYMid meet'} focusable="false"><svg x={bound[0]} y={bound[1]} width={bound[2]} height={bound[3]} viewBox={bound.join(' ')} overflow="hidden"><image href={source as unknown as string} width={sourceWidth} height={sourceHeight}/></svg></svg>:<svg className="mobile-art-svg mobile-art-vector" viewBox="0 0 24 24" fill="currentColor" shapeRendering="crispEdges" focusable="false">{symbols[kind as PixelSymbol]??symbols.piece}</svg>}
 </span>;
}

