// Restore these entries when personal play and paid membership are ready.
// This does not erase existing rooms, uploads, accounts, or membership records.
export const PERSONAL_PLAY_VISIBLE = false;
export const MEMBERSHIP_VISIBLE = false;
// Uploading your own picture to build a puzzle is open to signed-in accounts and
// is independent of PERSONAL_PLAY_VISIBLE: the entry and the page stay reachable
// while solo mode and paid membership remain hidden.
export const USER_IMAGE_UPLOAD_VISIBLE = true;
export function galleryEntry(mode?:string){
 if(mode==='create'&&MEMBERSHIP_VISIBLE)return {entryMode:'create' as const,guestPlay:false};
 if(mode==='solo'&&PERSONAL_PLAY_VISIBLE)return {entryMode:'solo' as const,guestPlay:false};
 if(mode==='public'||!PERSONAL_PLAY_VISIBLE)return {entryMode:'public' as const,guestPlay:false};
 return {entryMode:'solo' as const,guestPlay:true};
}

// Temporary presentation pause; stored gardens and reward accounting are retained.
export const COURTYARD_VISIBLE = false;

// 2026-10-06 presentation pause for secondary retention systems. These flags
// only remove user-facing entry points; the existing APIs, inventories, and
// equipped bubble/cursor rendering remain available for backwards compatibility.
export const CHECKIN_VISIBLE = false;
export const HATCHING_VISIBLE = false;
export const WARDROBE_VISIBLE = false;
export const DECORATION_VISIBLE = false;
