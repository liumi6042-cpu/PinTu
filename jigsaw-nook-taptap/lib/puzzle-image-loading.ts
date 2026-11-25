// Announce only the selected original, never the whole gallery. Keeping one
// reusable hint also bounds DOM growth during a long visit.
export function preloadPuzzleImage(src:string){
 if(typeof document==='undefined'||!/^\/puzzles\/[^/]+-(?:play|standard|optimized|compact)-[a-f0-9]{12}\.webp$/.test(src))return;
 let hint=document.querySelector<HTMLLinkElement>('link[data-puzzle-image]');
 if(!hint){hint=document.createElement('link');hint.rel='preload';hint.as='image';hint.dataset.puzzleImage='';document.head.appendChild(hint);}
 hint.fetchPriority='high';hint.href=src;
}
