export type GestureCamera={x:number;y:number;z:number};
export type GestureFrame={camera:GestureCamera;width:number;height:number};
export type GestureFrameSample={x:number;y:number;width:number;height:number};

/**
 * Maps the current viewport into a cached, overscanned frame. All dimensions are
 * CSS pixels; the caller applies its own backing-store pixel ratio.
 */
export function gestureFrameSample(frame:GestureFrame,current:GestureCamera,viewportWidth:number,viewportHeight:number):GestureFrameSample|null{
  if(!Number.isFinite(current.z)||current.z<=0||!Number.isFinite(frame.camera.z)||frame.camera.z<=0)return null;
  const ratio=frame.camera.z/current.z;
  const sample={
    x:frame.camera.x-current.x*ratio,
    y:frame.camera.y-current.y*ratio,
    width:viewportWidth*ratio,
    height:viewportHeight*ratio
  };
  const epsilon=.5;
  if(sample.x< -epsilon||sample.y< -epsilon||sample.x+sample.width>frame.width+epsilon||sample.y+sample.height>frame.height+epsilon)return null;
  return sample;
}
