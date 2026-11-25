import type {Rect} from './ports';
export const PAL={O:'#5a2232',R:'#e05a6e',r:'#f49aa8',d:'#b03850',W:'#fff6ea',Y:'#f4c24f',y:'#ffe397',g:'#cf952d',S:'#f7cfae',s:'#e3a07e',P:'#f28aa6',B:'#6fa3d8',G:'#7fb069',L:'#b98ad6',C:'#d29a68',c:'#a86a3f',K:'#4a2a2a',M:'#fff3e3',N:'#f2a65a',w:'#fffaf2',E:'#3a1f25',p:'#f6a3b5'};
export const ICON={
clap:['..Y.........Y...','...Y..OO...Y....','.....OSSO...OO..','....OSSSO..OSSO.','...OSSSSO.OSSSO.','...OSSSSSOSSSSO.','..OSSSSSSOSSSSO.','..OSSSSSSSSSSsO.','..OSSSSSSSSSsO..','..OsSSSSSSSssO..','...OsSSSSSssO...','....OssSSssO....','.....OsssssO....','......OOOOO.....','................','................'],
popper:['.........P...Y..','...G.....Y......','......B.....P...','..........G.....','...P......OOO.B.','.........OWyYO..','........OyYrYO.Y','.......OyYrrYO..','......OYrrYYgO..','.....OYYYYrgO...','....OrrYYrgO....','....OYrrYgO.....','...OYYYrgO......','...OggggO.......','...OOOOO........','................'],
heart:['................','................','..OOOO....OOOO..','.OrWrRO..ORRRRO.','OrWrRRROORRRRRdO','OrrRRRRRRRRRRRdO','ORRRRRRRRRRRRRdO','ORRRRRRRRRRRRRdO','.ORRRRRRRRRRRdO.','..ORRRRRRRRRdO..','...ORRRRRRRdO...','....ORRRRRdO....','.....ORRRdO.....','......ORdO......','.......OO.......','................'],
star:['.......OO.......','......OyyO......','......OyYO......','.....OyYYYO.....','OOOOOOyYYYOOOOOO','OyyyyyYYYYYYYYgO','.OyYYYYYYYYYYgO.','..OYYYYYYYYYgO..','...OYYYYYYYgO...','...OYYYYYYYgO...','..OYYYYgYYYYgO..','..OYYYgOOgYYgO..','.OYYgOO..OOgYgO.','.OYgO......OggO.','.OOO........OOO.','................'],
tea:['..........PP....','.........PP.....','...OOOOOOPOOO...','...OMMMMMPMMO...','...OOOOOOOOOO...','....OCWCCCCO....','....OCWCCCcO....','....OCCCCCcO....','....OCKCCKcO....','....OKCKCCcO....','....OCCKCKcO....','.....OCCCcO.....','.....OOOOOO.....','................','................','................'],
cat:['................','.OO..........OO.','.OpO........OpO.','.OppO......OppO.','.ONNNOOOOOONNNO.','ONNNNNNNNNNNNNNO','ONNNNNNNNNNNNNNO','ONNEENNNNNNEENNO','ONNEENNNNNNEENNO','ONNNNNwwwwNNNNNO','OpNNwwwppwwwNNpO','ONNNwwEwwEwwNNNO','.ONNNwwwwwwNNNO.','..ONNNNNNNNNNO..','...OOOOOOOOOO...','................'],
crown:['................','................','................','.O....OO....O...','OYO..OYYO..OYO..','OYYO.OYYO.OYYO..','OYYYOYYYYOYYYO..','OYYYYYYYYYYYYO..','OYrYYYBYYYYrYO..','OYYYYYYYYYYYYO..','OggggggggggggO..','.OOOOOOOOOOOO...','................','................','................','................']};
export type CheerIcon=keyof typeof ICON;
/** Integer pixels only; works on both browser and wx 2D contexts. */
export function drawCheerIcon(ctx:CanvasRenderingContext2D,id:CheerIcon,rect:Rect){
 const scale=Math.max(1,Math.floor(Math.min(rect.w,rect.h)/16)),x=Math.round(rect.x+(rect.w-16*scale)/2),y=Math.round(rect.y+(rect.h-16*scale)/2);
 ctx.save();ctx.imageSmoothingEnabled=false;
 ICON[id].forEach((row,iy)=>{for(let ix=0;ix<row.length;ix++){const color=PAL[row[ix] as keyof typeof PAL];if(color){ctx.fillStyle=color;ctx.fillRect(x+ix*scale,y+iy*scale,scale,scale);}}});ctx.restore();
}
