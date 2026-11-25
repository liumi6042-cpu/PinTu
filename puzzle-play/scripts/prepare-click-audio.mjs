// Pack the four approved audition WAVs into the client bundle. No request or
// audio decoding is needed during a drop; createBuffer preserves their 48kHz rate.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)),directory=resolve(root,'content/sound-effects/crisp-double-click');
const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8')),encoded=[];
for(const item of manifest.files){
 const data=readFileSync(resolve(directory,item.file));
 if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Audition hash differs: '+item.file);
 if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV');
 let format=false,pcm;
 for(let offset=12;offset+8<=data.length;){
  const type=data.toString('ascii',offset,offset+4),size=data.readUInt32LE(offset+4),start=offset+8;
  if(start+size>data.length)throw Error('Truncated WAV');
  if(type==='fmt ')format=size>=16&&data.readUInt16LE(start)===1&&data.readUInt16LE(start+2)===1&&data.readUInt32LE(start+4)===48000&&data.readUInt16LE(start+14)===16;
  if(type==='data')pcm=data.subarray(start,start+size);
  offset=start+size+(size%2);
 }
 if(!format||!pcm||pcm.length!==9408)throw Error('Expected a 98ms mono 48kHz PCM16 click');
 encoded.push(pcm.toString('base64'));
}
if(encoded.length!==4)throw Error('Expected four chosen click variants');
writeFileSync(resolve(root,'lib/double-click-data.ts'),'// Generated from the approved C audition. Run node scripts/prepare-click-audio.mjs.\nexport const DOUBLE_CLICK_SAMPLE_RATE=48000;\nexport const DOUBLE_CLICK_PCM16='+JSON.stringify(encoded)+' as const;\n');
console.log(JSON.stringify({variants:encoded.length,sourceBytes:encoded.length*9408,sampleRate:48000,durationMs:98}));
