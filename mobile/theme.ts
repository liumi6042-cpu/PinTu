/** UI colours only. Artwork and puzzle textures always retain their source colours. */
export type ThemeId='light'|'dark'|'wood';

export const lightThemeColors=Object.freeze({paper:'#fdf6ed',cream:'#fff9f0',ink:'#642238',muted:'#8a5a5f',rose:'#c7808b',berry:'#c7808b',gold:'#d7ad68',line:'#cda394',green:'#879864',onAccent:'#fffaf0',overlay:'#3c203c80',highlight:'#fffaf3',placeholder:'#efdfcc',disabled:'#8b6868'});
export const darkThemeColors=Object.freeze({paper:'#29232c',cream:'#332a34',ink:'#fff2e3',muted:'#c5a4aa',rose:'#ce8190',berry:'#ce8190',gold:'#dfbb7d',line:'#85616c',green:'#a4b681',onAccent:'#fffaf0',overlay:'#100d18b3',highlight:'#352b36',placeholder:'#463644',disabled:'#ab9097'});
export type ThemeColors={readonly [Key in keyof typeof lightThemeColors]:string};
export function themeColors(theme:ThemeId):ThemeColors{return theme==='dark'?darkThemeColors:lightThemeColors;}
export function isThemeId(value:unknown):value is ThemeId{return value==='light'||value==='dark'||value==='wood';}

// Each source pixel-frame colour has an explicit dark equivalent. This keeps the
// existing 35 nine-slice shapes and physical-pixel painting completely unchanged.
const darkUiColorGroups:readonly(readonly[string,readonly string[]])[]=[
 ['#e3a2a7',['#602c3b']],
 ['#b18487',['#753843']],
 ['#754451',['#773e4d','#874754']],
 ['#6c4447',['#7c4842','#8d5347']],
 ['#241d27',['#845558','#966160','#8a5b60']],
 ['#a66075',['#a25e6d','#a86373','#b16e7b','#b36e7c','#b06b79']],
 ['#80696f',['#aa8384']],
 ['#be7585',['#be7a84']],
 ['#b9854f',['#b17c4e','#b9854f','#c08f59','#c0905d','#c4945b']],
 ['#87636c',['#be9695','#cba3a0','#dbb5b2']],
 ['#725b61',['#c29e8c','#c8a89d','#cdada4','#d2b092']],
 ['#c98191',['#c8838d']],
 ['#cf8b98',['#cc8c94']],
 ['#cda469',['#cca16b']],
 ['#d8af70',['#d8af70']],
 ['#dfba80',['#dbb57a']],
 ['#201b24',['#c7a08d','#d2ae97','#dbbead','#e2c7b4','#e6cabd']],
 ['#2b232d',['#dcbfad','#edd3c2','#eedfd5','#fbefe1']],
 ['#85616c',['#ddb8a5','#e0bcaa','#efd6c5']],
 ['#5c4853',['#dcc1ae','#f0decf','#f2e1d3']],
 ['#a28087',['#e3bebb']],
 ['#ecb6bb',['#e8b1b1','#efc6c2','#f4d8d8','#f7e3e1']],
 ['#9f8a6e',['#e1c5a5','#e9d1af']],
 ['#67515a',['#f5e7d6','#f7ebdd']],
 ['#40323c',['#faeee1']],
 ['#f1d498',['#ffecb8','#fff0c7','#fff6dc','#fff8e3']],
 ['#65505b',['#fff1d9','#fff3de','#fff8ec','#fff9ef','#fffdf8','#fffefa']],
 ['#352b35',['#fff6e9']],
 // Existing scene fills, dividers and text accents.
 ['#29232c',['#fdf6ed']],
 ['#332a34',['#fff9f0','#fff7ed','#fff8ef','#fff8ed','#fff9ee','#fff8ee']],
 ['#352b36',['#fffaf3']],
 ['#fff2e3',['#642238','#75424f','#704350']],
 ['#c5a4aa',['#a67578','#8a5a5f','#997a76','#876158','#896c63','#9d7b7b','#8b6868']],
 ['#ce8190',['#c7808b','#cb7f90','#bc7889','#cc8996','#b9848d','#b46177']],
 ['#dfbb7d',['#d7ad68']],
 ['#a4b681',['#879864']],
 ['#85616c',['#cda394','#c99586','#d4ac99','#d5ac99','#ddbdac','#e0bbaa','#dfbdad','#b78388','#b07882','#b9828b','#c49a8d','#b28c88']],
 ['#463644',['#efdfcc','#f8e8d8','#f8eddf','#f7e3d5','#f4e7db','#eee7db','#e7cbbc']],
 ['#60404e',['#eed4d9','#efd9d6']],
 ['#c4a878',['#f2d5ad','#f2ddb9','#fae7b8','#f2efd8']],
 ['#332637',['#674625','#a36c2e','#83542f','#7a7244']],
 ['#ead6c5',['#cdb6b3','#e8c9b8']],
 ['#eb9baa',['#a54860','#874450']],
 ['#a67887',['#925363','#8c4059','#ba667e']],
 ['#91707b',['#e3bda4']],
 ['#c7a46c',['#ccaa68','#c8b781','#e8c496']],
 ['#d394a0',['#d99ba4']],
 ['#eabac0',['#efc6c9']],
 ['#201925',['#a86273']],
 ['#54434f',['#fffdf6','#fff6eb','#fff3e7']],
 // Level hues remain distinct while gaining contrast on charcoal surfaces.
 ['#e6a0ce',['#a34f8c']],
 ['#bdb0e6',['#4a4277']],
 ['#e5a0bf',['#ac5f82']],
 ['#caacd9',['#9971a7']],
 ['#e2bd78',['#b6863c','#ad843b']],
 ['#b3c6d2',['#758795']],
 ['#dfa0b8',['#b16984']],
 ['#c5abe4',['#8c6bac']],
 ['#a5cde6',['#638ca7']],
 ['#adc995',['#749866']],
];
const darkUiColors=new Map(darkUiColorGroups.flatMap(([target,sources])=>sources.map(source=>[source.toLowerCase(),target] as const)));
const darkGoldPanelColors:Record<string,string>={'#d8af70':'#66533b','#ffecb8':'#947c56','#b9854f':'#3e3228'};

/** Translate a known UI colour while preserving an optional alpha byte. */
export function themeUiColor(theme:ThemeId,color:string){
 if(theme!=='dark')return color;
 const match=/^(#[\da-f]{6})([\da-f]{2})?$/i.exec(color);
 if(match)return(darkUiColors.get(match[1].toLowerCase())??match[1])+(match[2]??'');
 if(color==='rgba(232,212,196,.77)')return'rgba(50,41,54,.77)';
 return color;
}
/** Gold panels contain normal body text, unlike accent buttons with cream labels. */
export function themeFrameColor(theme:ThemeId,frame:string,color:string){
 if(theme==='dark'&&frame==='panel-gold'){
  const mapped=darkGoldPanelColors[color.toLowerCase()];if(mapped)return mapped;
 }
 return themeUiColor(theme,color);
}
/** Cream labels on coloured buttons stay light; surface colours are not text colours. */
export function themeTextColor(theme:ThemeId,color:string){
 if(/^#(?:fff|fffe|fffd)/i.test(color))return color;
 return themeUiColor(theme,color);
}

// Light keeps the original mini-game palette; wood is the optional Web tabletop.
export function boardThemeColors(theme:ThemeId){return theme==='dark'?{
 paper:'#212327',paperEdge:'#212327',paperDot:'#c8b99c14',target:'#303338',targetLine:'#75777c',targetGrid:'#9a9ca047',piecePlaceholder:'#735c66',pieceLine:'#b28c99',focus:'#e9a0b1',hint:'#fff0b7',hintLine:'#e5a3b3',label:'#332a34ee',cursorLabel:'#332a34',labelInk:'#fff2e3',preview:'#45343d',previewLine:'#b78b93',cursorLine:'#d4abb6',tray:'#332a34f5',trayLine:'#98727f',trayInk:'#fff2e3',trayCountInk:'#fff2e3',trayMuted:'#c5a4aa',trayCell:'#43343e',traySelected:'#684753',trayDisabled:'#816d76',
 }:{
 paper:theme==='wood'?'#e0d5bf':'#fdf6ed',paperEdge:theme==='wood'?'#e0d5bf':'#fff9f0',paperDot:theme==='wood'?'#9984651a':'#b078821a',target:theme==='wood'?'#cabc9f':'#fff7ed',targetLine:theme==='wood'?'#94836d':'#b07882',targetGrid:theme==='wood'?'#94836d59':'#b0788259',piecePlaceholder:'#e7cbbc',pieceLine:'#b28c88',focus:'#cb7f90',hint:'#874450',hintLine:'#bc7889',label:'#fffaf3ee',cursorLabel:'#fff8ed',labelInk:'#642238',preview:'#fff9ee',previewLine:'#b9828b',cursorLine:'#69434c',tray:'#fff8eef5',trayLine:'#b78388',trayInk:'#75424f',trayCountInk:'#704350',trayMuted:'#997a76',trayCell:'#f8eddf',traySelected:'#eed4d9',trayDisabled:'#cdb6b3',
 };}
