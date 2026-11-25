export type ScreenOrientation='portrait'|'landscape';
export const orientationPreferenceKey='jigsaw:orientation:v1';
export function readOrientationPreference(storage:{get(key:string):string|null}):ScreenOrientation|null{try{const value=storage.get(orientationPreferenceKey);return value==='portrait'||value==='landscape'?value:null;}catch{return null;}}
/** No saved choice means the host keeps the orientation configured for this upload. */
export function launchOrientation(storage:{get(key:string):string|null}):ScreenOrientation|null{return readOrientationPreference(storage);}
/** Uploads are landscape (TapTap PC keeps that window). Phones restore a saved choice, or on a first launch ask for portrait;
 * that request is returned so the first-entry picker can wait for it. A failed turn stays silent here. */
export function requestLaunchOrientation(platform:{storage:{get(key:string):string|null};setOrientation?(value:ScreenOrientation):Promise<void>;orientationChoiceAvailable?():boolean;tapPcHost?():boolean}):Promise<void>|undefined{
 if(!platform.setOrientation||platform.tapPcHost?.()===true)return undefined;
 const saved=launchOrientation(platform.storage);
 if(saved){void platform.setOrientation(saved).catch(()=>{});return undefined;}
 return platform.orientationChoiceAvailable?.()===true?platform.setOrientation('portrait').catch(()=>{}):undefined;
}
export function saveOrientationPreference(storage:{set(key:string,value:string):void},value:ScreenOrientation){try{storage.set(orientationPreferenceKey,value);}catch{}}
