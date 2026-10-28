export type ScreenOrientation='portrait'|'landscape';
export const orientationPreferenceKey='jigsaw:orientation:v1';
export function readOrientationPreference(storage:{get(key:string):string|null}):ScreenOrientation|null{try{const value=storage.get(orientationPreferenceKey);return value==='portrait'||value==='landscape'?value:null;}catch{return null;}}
export function launchOrientation(storage:{get(key:string):string|null}):ScreenOrientation{return readOrientationPreference(storage)??'portrait';}
export function saveOrientationPreference(storage:{set(key:string,value:string):void},value:ScreenOrientation){try{storage.set(orientationPreferenceKey,value);}catch{}}
