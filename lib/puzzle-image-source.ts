export type PuzzleImageSource={src:string;standardSrc?:string};
// Offline, losslessly encoded smaller delivery is enough for <=1000 pieces.
// Selecting a big puzzle loads the complete stitched original once.
export function puzzleImageSource(photo:PuzzleImageSource,pieces:number){return pieces<=1000&&photo.standardSrc?photo.standardSrc:photo.src;}
