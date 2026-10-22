/** Browser fullscreen for the complete game page, including Canvas menus. */
export function webFullscreen(doc:Document){
 return {
  available:()=>doc.fullscreenEnabled===true&&typeof doc.documentElement?.requestFullscreen==='function'&&typeof doc.exitFullscreen==='function',
  active:()=>!!doc.fullscreenElement,
  async toggle(){if(doc.fullscreenElement)await doc.exitFullscreen();else await doc.documentElement.requestFullscreen();return !!doc.fullscreenElement;},
 };
}
