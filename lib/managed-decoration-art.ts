export const MANAGED_ART_KEYS=['star','bow','butterfly','feather','moon','lantern','leaf'] as const;
export type ManagedCursorArt={id:string;artKey:string;color:string};
const paths:Record<string,string>={
 star:'<path d="m16 5 3.2 6.5 7.2 1-5.2 5 1.2 7.1-6.4-3.4-6.4 3.4 1.2-7.1-5.2-5 7.2-1z"/>',
 bow:'<path d="M15 13C10 5 4 8 5 14s7 6 10 3M17 13c5-8 11-5 10 1s-7 6-10 3"/><circle cx="16" cy="15" r="3"/><path d="m14 18-4 9 6-3 6 3-4-9"/>',
 butterfly:'<path d="M15 16C7 3 2 7 5 15c-5 7 4 12 10 4m2-3C25 3 30 7 27 15c5 7-4 12-10 4"/><path d="M16 12v13m0-13-3-5m3 5 3-5" fill="none"/>',
 feather:'<path d="M7 26C4 11 14 3 27 5c0 11-7 19-20 21"/><path d="m7 26 14-14m-9 9v-8m5 3h8" fill="none"/>',
 moon:'<path d="M24 23A12 12 0 1 1 13 5a11 11 0 0 0 11 18"/><path d="m24 5 1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
 lantern:'<path d="M11 8h10l4 6-2 10H9L7 14z"/><path d="M11 8V5h10v3M10 24h12M16 24v5M16 9v13" fill="none"/>',
 leaf:'<path d="M6 25C4 12 13 4 27 5c0 13-8 23-21 20"/><path d="m6 25 15-14m-10 9v-7m4 3h7" fill="none"/>',
};
export function validManagedCursor(value:unknown):value is ManagedCursorArt{
 if(!value||typeof value!=='object')return false;
 const item=value as ManagedCursorArt;
 return typeof item.id==='string'&&/^[a-z][a-z0-9-]{1,63}$/.test(item.id)&&MANAGED_ART_KEYS.includes(item.artKey as typeof MANAGED_ART_KEYS[number])&&typeof item.color==='string'&&/^#[a-f\d]{6}$/i.test(item.color);
}
// Both local and shared pointers use exactly the same art and center hotspot.
export function managedCursorSvg(item:ManagedCursorArt){
 if(!validManagedCursor(item))return '';
 return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="${item.color}" stroke="#fffaf0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[item.artKey]}</g><circle cx="16" cy="16" r="1.4" fill="#493a30"/></svg>`;
}
export function managedCursorUrl(item:ManagedCursorArt){return 'data:image/svg+xml,'+encodeURIComponent(managedCursorSvg(item));}
