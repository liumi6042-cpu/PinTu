export type PuzzleImageSource={src:string;optimizedSrc?:string};
// One delivery file per picture since 2026-10-17 (Q70, longest side 2560), so the
// requested piece count no longer changes which file is downloaded.
export function puzzleImageSource(photo:PuzzleImageSource){
 return photo.optimizedSrc??photo.src;
}
