export type PuzzleImageSource={src:string;standardSrc?:string;optimizedSrc?:string;optimizedStandardSrc?:string};
// Delivery encoding is offline. Existing large rooms retain native dimensions;
// ordinary games use the compact derivative when the artwork has one.
export function puzzleImageSource(photo:PuzzleImageSource,pieces:number){
 if(pieces<=1000)return photo.optimizedStandardSrc??photo.optimizedSrc??photo.standardSrc??photo.src;
 return photo.optimizedSrc??photo.src;
}
