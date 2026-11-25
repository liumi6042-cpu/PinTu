/** Canvas 引导与原生按钮共用 CSS 像素布局，避免缩放与横竖屏错位。 */
export function tapAuthorizationLayout(width:number,height:number,top=0,bottom=0){
 const w=Math.min(430,width-24),available=height-top-bottom-24,h=Math.min(180,available),x=(width-w)/2,y=top+12+(available-h)/2,half=(w-40)/2;
 return {panel:{x,y,w,h},button:{left:x+24+half,top:y+h-54,width:half,height:38},cancel:{x:x+16,y:y+h-54,w:half,h:38}};
}
