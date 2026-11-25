// Players still run WebViews from the Chrome 85-91 era (Huawei/HarmonyOS, un-updated Android System WebView).
// esbuild lowers syntax to the build target but never adds a missing built-in, so a bundle calling a newer one
// breaks only on those phones: Array.prototype.at threw in every solo-local drop and levels looked finished at
// 0 / 12 (2026-11-02). Built-ins installed by mobile/legacy-runtime.ts are allowed; any other newer one fails.
const POLYFILLED=[
 ['Array/String .at() (Chrome 92)',/\.at\(/g],
 ['Object.hasOwn (Chrome 93)',/\bObject\.hasOwn\b/g],
 ['findLast/findLastIndex (Chrome 97)',/\.findLast(?:Index)?\(/g],
];
const MISSING=[
 ['crypto.randomUUID (Chrome 92)',/\.randomUUID\b/g],
 ['toSorted/toReversed/toSpliced (Chrome 110)',/\.(?:toSorted|toReversed|toSpliced)\(/g],
 ['Object.groupBy/Map.groupBy (Chrome 117)',/\b(?:Object|Map)\.groupBy\b/g],
 ['Promise.withResolvers (Chrome 119)',/\bPromise\.withResolvers\b/g],
 ['Array.fromAsync (Chrome 121)',/\bArray\.fromAsync\b/g],
 ['String isWellFormed/toWellFormed (Chrome 111)',/\.(?:isWellFormed|toWellFormed)\(/g],
];
// Used only behind a typeof check (with a fallback).
const GUARDED=[
 ['structuredClone (Chrome 98)',/\bstructuredClone\(/g,/typeof structuredClone/],
 ['AbortSignal.timeout (Chrome 103)',/\bAbortSignal\.timeout\(/g,/typeof AbortSignal\.timeout/],
];
export function legacyApiProblems(code){
 const problems=[],count=pattern=>(code.match(pattern)??[]).length;
 const polyfilled=code.includes('"hasOwn"')&&code.includes('"findLastIndex"');
 for(const [name,pattern] of POLYFILLED)if(!polyfilled&&count(pattern))problems.push(name+' used without mobile/legacy-runtime.ts');
 for(const [name,pattern] of MISSING)if(count(pattern))problems.push(name+' is not available on older WebViews');
 for(const [name,pattern,guard] of GUARDED){
  for(const match of code.matchAll(pattern)){const before=code.slice(Math.max(0,match.index-160),match.index);if(!guard.test(before)){problems.push(name+' without a typeof guard');break;}}
 }
 return problems;
}
