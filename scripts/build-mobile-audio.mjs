// Reuse the approved, locally synthesized C audition. There are no external
// recordings or samples; source.py and the provenance manifest remain in content/.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=resolve(root,'content/sound-effects/crisp-double-click');
const manifest=JSON.parse(readFileSync(resolve(source,'manifest.json'),'utf8'));
const item=manifest.files.find(file=>file.file==='click-v1.wav');
if(!item)throw Error('Approved click-v1 source is missing');
const wav=readFileSync(resolve(source,item.file));
const sha256=createHash('sha256').update(wav).digest('hex');
if(sha256!==item.sha256)throw Error('Approved click source hash differs');
if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||wav.length!==9452||wav.readUInt16LE(20)!==1||wav.readUInt16LE(22)!==1||wav.readUInt32LE(24)!==48000||wav.readUInt16LE(34)!==16)throw Error('Expected the original 98ms mono 48kHz PCM16 click');
const directory=resolve(root,'public/audio');
mkdirSync(directory,{recursive:true});
writeFileSync(resolve(directory,'mobile-snap.wav'),wav);
console.log(JSON.stringify({path:'public/audio/mobile-snap.wav',bytes:wav.length,sampleRate:48000,durationMs:98,sha256}));

// Original reward chime, generated alongside the existing snap effect.
await import('../content/sound-effects/coin-reward/generate.mjs');
