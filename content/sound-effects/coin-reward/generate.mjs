// Original procedural coin chimes; no recordings or third-party samples.
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const rate=48000,duration=.68,count=Math.round(rate*duration),values=new Float64Array(count);
for(const [start,freq,gain] of [[0,1760,.7],[.075,2349,.6],[.16,3136,.52],[.245,3520,.38]]){
 for(let i=Math.floor(start*rate);i<count;i++){const t=i/rate-start;if(t<0)continue;const attack=Math.min(1,t/.002);values[i]+=gain*attack*(Math.sin(2*Math.PI*freq*t)*Math.exp(-t/ .09)+.32*Math.sin(2*Math.PI*freq*2.71*t)*Math.exp(-t/.035)+.12*Math.sin(2*Math.PI*freq*4.13*t)*Math.exp(-t/.018));}
}
const peak=Math.max(...values.map(Math.abs)),wav=Buffer.alloc(44+count*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(count*2,40);
for(let i=0;i<count;i++)wav.writeInt16LE(Math.round(values[i]/peak*.85*32767*Math.min(1,(count-1-i)/(rate*.015))),44+i*2);
const root=new URL('../../../',import.meta.url);for(const path of ['content/sound-effects/coin-reward/coin-reward.wav','public/audio/mobile-coin.wav'])writeFileSync(new URL(path,root),wav);
writeFileSync(new URL('content/sound-effects/coin-reward/manifest.json',root),JSON.stringify({origin:'original-procedural-synthesis',source:'generate.mjs',durationMs:680,sampleRate:rate,channels:1,sha256:createHash('sha256').update(wav).digest('hex')},null,2)+'\n');
