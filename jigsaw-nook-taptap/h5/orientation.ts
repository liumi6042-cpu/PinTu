export type DisplayMode='auto'|'portrait'|'landscape';
type Sensor={x:number;y:number;z:number};
type Host={setDeviceOrientation?:(options:{value:'portrait'|'landscape';success:()=>void;fail:()=>void})=>void;onAccelerometerChange?:(listener:(value:Sensor)=>void)=>void;offAccelerometerChange?:(listener:(value:Sensor)=>void)=>void};
export function startOrientation(mode:DisplayMode,message:(value:string)=>void){
 const host=window.tap as unknown as Host|undefined;let active=true;
 const rotate=(value:'portrait'|'landscape')=>{
  if(!host?.setDeviceOrientation){message('此客户端不能强制转屏，请使用手机的系统旋转设置');return;}
  try{host.setDeviceOrientation({value,success:()=>{if(active){message('');window.dispatchEvent(new Event('resize'));}},fail:()=>{if(active)message('当前客户端暂不能切换方向，布局仍会随窗口调整');}});}catch{message('当前客户端暂不能切换方向，布局仍会随窗口调整');}
 };
 message('');
 if(mode!=='auto'){rotate(mode);return()=>{active=false;};}
 try{screen.orientation?.unlock?.();}catch{}
 if(!host?.setDeviceOrientation)return()=>{active=false;};
 if(!host.onAccelerometerChange||!host.offAccelerometerChange){message('当前客户端不能自动转屏，可以选择横屏或竖屏');return()=>{active=false;};}
 let current=window.innerWidth>window.innerHeight?'landscape':'portrait',candidate=current,since=0,last=0;
 const listener=(s:Sensor)=>{
  if(!active||document.hidden)return;const x=Math.abs(s.x),y=Math.abs(s.y),z=Math.abs(s.z);if(![x,y,z].every(Number.isFinite)||Math.max(x,y)<.35||z>Math.max(x,y)*2)return;
  const next=x>y*1.4?'landscape':y>x*1.4?'portrait':null;if(!next)return;
  const now=Date.now();if(next!==candidate){candidate=next;since=now;return;}if(next===current||now-since<600||now-last<1500)return;
  current=next;last=now;rotate(next);
 };
 try{host.onAccelerometerChange(listener);}catch{message('此客户端不能自动转屏，可以选择横屏或竖屏');}
 return()=>{active=false;try{host.offAccelerometerChange?.(listener);}catch{}};
}
