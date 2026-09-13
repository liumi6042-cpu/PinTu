// Restore these entries when personal play and paid membership are ready.
// This does not erase existing rooms, uploads, accounts, or membership records.
export const PERSONAL_PLAY_VISIBLE = false;
export const MEMBERSHIP_VISIBLE = false;
export function galleryEntry(mode?:string){
 if(mode==='create'&&MEMBERSHIP_VISIBLE)return {entryMode:'create' as const,guestPlay:false};
 if(mode==='solo'&&PERSONAL_PLAY_VISIBLE)return {entryMode:'solo' as const,guestPlay:false};
 if(mode==='public'||!PERSONAL_PLAY_VISIBLE)return {entryMode:'public' as const,guestPlay:false};
 return {entryMode:'solo' as const,guestPlay:true};
}
