export type ScreenOrientation='portrait'|'landscape';
export const orientationPreferenceKey='jigsaw:orientation:v1';
export function readOrientationPreference(storage:{get(key:string):string|null}):ScreenOrientation|null{try{const value=storage.get(orientationPreferenceKey);return value==='portrait'||value==='landscape'?value:null;}catch{return null;}}
/** No saved choice means the host keeps the orientation configured for this upload. */
export function launchOrientation(storage:{get(key:string):string|null}):ScreenOrientation|null{return readOrientationPreference(storage);}
export function saveOrientationPreference(storage:{set(key:string,value:string):void},value:ScreenOrientation){try{storage.set(orientationPreferenceKey,value);}catch{}}
