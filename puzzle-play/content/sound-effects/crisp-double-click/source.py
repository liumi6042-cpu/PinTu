"""Short original latch/click sound candidates. No recordings or sample packs."""
from pathlib import Path
import array,hashlib,json,math,random,sys,wave,zipfile

ROOT=Path(__file__).resolve().parent
SR=48000
TAU=math.tau
TYPES=[('A-cardboard-snap','纸板卡合','轻微纸张触感，接着短促咔哒。'),('B-wooden-latch','木质卡扣','更扎实的卡入声，略偏木质。'),('C-clean-click','轻脆双击','更清楚、更轻脆的双段咔哒。')]

def lowpass(data,hz,passes=1):
 alpha=1-math.exp(-TAU*hz/SR)
 for _ in range(passes):
  value=0.;out=[]
  for x in data:value+=alpha*(x-value);out.append(value)
  data=out
 return data

def env(t,attack,decay,length):
 if t<0 or t>=length:return 0.
 return math.sin(min(1,t/attack)*math.pi/2)**2*math.exp(-t/decay)*(1-t/length)**2

def make(kind,variation):
 rng=random.Random(3913+kind*257+variation*71)
 shift=[.986,1.008,1.019,.997][variation]
 length=round(SR*.098)
 noise=[rng.uniform(-1,1) for _ in range(length)]
 low=lowpass(noise,220)
 mid=lowpass(noise,1650*shift,2)
 high=lowpass(noise,4200*shift,2)
 # All resonances decay within a few milliseconds; no melodic or ringing tail.
 values=[]
 for i in range(length):
  t=i/SR
  if kind==0:
   u=t-.009;v=t-(.023+variation*.0006)
   paper=(mid[i]-low[i])*.16*env(t,.003,.008,.018)
   first=((high[i]-mid[i])*2.8+(mid[i]-low[i])*.7)*env(u,.00055,.0042,.024)
   seated=(.42*math.cos(TAU*670*shift*v)+.20*math.cos(TAU*1210*shift*v)+mid[i]*.6)*env(v,.0009,.008,.043)
   value=paper+first+seated
  elif kind==1:
   u=t-.004;v=t-(.018+variation*.0007)
   first=((high[i]-mid[i])*1.6+mid[i]*.9)*env(u,.0007,.0048,.025)
   body=(.6*math.cos(TAU*425*shift*v)+.25*math.cos(TAU*920*shift*v)+.11*math.cos(TAU*1580*shift*v))*env(v,.00075,.0065,.036)
   value=first+body
  else:
   u=t-.003;v=t-(.022+variation*.0005)
   first=((high[i]-mid[i])*3.1+.21*math.cos(TAU*1880*shift*u))*env(u,.00035,.0028,.016)
   second=((mid[i]-low[i])*1.1+.34*math.cos(TAU*1090*shift*v)+.15*math.cos(TAU*580*shift*v))*env(v,.00055,.0045,.024)
   value=first+second*.88
  values.append(value)
 # Remove sub-bass/DC and tame isolated needle peaks without lengthening the click.
 bass=lowpass(values,95)
 values=[math.tanh((x-b)*1.4) for x,b in zip(values,bass)]
 peak=max(map(abs,values));gain=.26/peak*(1+[-.012,.01,-.005,.014][variation])
 values=[x*gain*max(0,min(1,i/(SR*.0003),(length-1-i)/(SR*.006))) for i,x in enumerate(values)]
 assert all(math.isfinite(x) and abs(x)<.27 for x in values)
 return values

def save(path,values):
 path.parent.mkdir(parents=True,exist_ok=True)
 pcm=array.array('h',[round(x*32767) for x in values])
 if sys.byteorder!='little':pcm.byteswap()
 with wave.open(str(path),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes(pcm.tobytes())
 with wave.open(str(path),'rb') as f:assert f.getnframes()==len(values) and f.getframerate()==SR and f.getsampwidth()==2
 return {'file':path.relative_to(ROOT).as_posix(),'seconds':len(values)/SR,'peakDbFS':round(20*math.log10(max(map(abs,values))),2),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

if __name__ == "__main__":
 for variant in range(4):save(ROOT/f"click-v{variant+1}.wav",make(2,variant))
