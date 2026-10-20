"""Original note composition and deterministic synthesis, without samples.

Master stays here; a 64-kbps MP3 is the small game-delivery candidate.
The optional lameenc encoder is installed only in the task's ignored work folder.
"""
import hashlib,json,math,pathlib,sys,wave
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'work/background-music-20261019/tools'))
import lameenc

HERE=pathlib.Path(__file__).resolve().parent
LIGHT='--light' in sys.argv
RELAX='--relaxed-pulse' in sys.argv
VERSION=3 if RELAX else 2 if LIGHT else 1
TITLE={1:'午后小窗',2:'午后小窗 · 轻快版',3:'午后小窗 · 轻摇版'}[VERSION]
RATE=44100;BPM=78 if RELAX else 86 if LIGHT else 72;BEAT=60/BPM;BARS=16;DURATION=BARS*4*BEAT
N=round(DURATION*RATE);mix=np.zeros((N,2),dtype=np.float64);notes=[]
def add(midi,beat,velocity=.2,decay=2.0,pan=0.,box=False):
    # Warm, gently detuned modal tones with a soft hammer attack. These are
    # synthesized timbres, rather than recordings of an acoustic piano.
    duration=6 if box else 5
    t=np.arange(round(duration*RATE))/RATE;f=440*2**((midi-69)/12)
    partials=[(1,1.,1.),(2.003,.27,.72),(3.009,.105,.50),(4.018,.045,.33)]
    if box:partials=[(1,1.,1.1),(2.756,.10,.55),(5.405,.018,.30)]
    voice=np.zeros(t.size)
    for ratio,level,speed in partials:
        voice+=level*np.sin(2*np.pi*f*ratio*t)*np.exp(-t/(decay*speed))
    attack=1-np.exp(-t/(.018 if box and RELAX else .012 if box else .032 if RELAX else .021));release=np.clip((duration-t)/.35,0,1)
    voice*=attack*release*velocity*.36
    start=round(beat*BEAT*RATE)%N;indices=(start+np.arange(t.size))%N
    for channel,gain in enumerate([math.sqrt((1-pan)/2),math.sqrt((1+pan)/2)]):
        np.add.at(mix[:,channel],indices,voice*gain)
    notes.append({'midi':midi,'beat':round(beat,4),'velocity':velocity,'timbre':'glass-bell' if box else 'soft-keys'})

# Cmaj9 - G6/B - Am9 - Fmaj7, then Dm9 - Gadd9 - C/E - Gsus2.
chords=[(48,[60,64,67,71,74]),(47,[59,62,67,69,74]),(45,[60,64,67,71,72]),(41,[57,60,64,67,69]),
        (43,[60,62,65,69,72]),(43,[59,62,67,69,74]),(40,[55,60,64,67,71]),(43,[57,62,67,69,74])]
for bar in range(BARS):
    bass,chord=chords[bar%8];base=bar*4
    if RELAX:
        # Quiet two-beat bass and regular offbeat replies give a gentle pulse
        # without a drum track or a busy, skipping melody.
        add(bass+12,base,.17,1.5,-.08);add(bass+12,base+2,.115,1.2,.06)
        for index,offset in enumerate([.5,1.5,2.5,3.5]):
            add(chord[[0,2,1,2][index]],base+offset,[.105,.08,.10,.075][index],1.45,[-.22,.18,-.12,.20][index])
    elif LIGHT:
        # A lighter bass register and short, gently skipping broken chords.
        add(bass+12,base,.18,1.1,-.12);add(bass+12,base+2,.10,.85,.05)
        for index,offset in enumerate([.15,.9,1.65,2.5,3.25]):
            add(chord[[0,2,1,3,2][index]],base+offset,.105 if index%2 else .13,1.0,[-.28,.20,-.16,.26,.05][index])
    else:
        add(bass,base,.27,2.5,-.10);add(bass+12,base+2.08,.11,1.8,.05)
        for index,offset in enumerate([.12,1.02,2.12,3.02]):
            add(chord[[0,2,1,3][index]],base+offset,.12 if index%2 else .15,1.9,[-.33,.20,-.16,.30][index])

# Sparse original phrase, with space for the game's short connection clicks.
melody=[[(76,.55,.21),(74,2.55,.16)],[(71,1.0,.19)],[(72,.60,.20),(76,2.65,.15)],[(69,1.0,.18),(67,3.0,.12)],
        [(69,.65,.18),(72,2.6,.16)],[(74,1.0,.19),(71,3.0,.13)],[(67,.55,.15),(76,2.25,.18)],[(74,1.2,.16)],
        [(79,.55,.18),(76,2.5,.16)],[(74,1.0,.17),(71,3.05,.12)],[(76,.65,.19),(72,2.65,.15)],[(69,1.1,.17)],
        [(72,.55,.18),(69,2.6,.14)],[(71,.8,.17),(74,2.75,.15)],[(76,.65,.18),(74,2.7,.13)],[(71,.75,.14)]]
if LIGHT:
    melody=[[(76,.25,.20),(79,1,.15),(76,2.5,.17)],[(74,.25,.18),(71,1.75,.15),(74,3,.14)],
            [(76,.25,.19),(72,1.5,.15),(76,2.25,.16)],[(77,.5,.18),(76,1.25,.14),(72,2.75,.16)],
            [(74,.25,.18),(77,1.5,.16),(76,2.25,.13)],[(74,.5,.18),(71,1.25,.15),(67,2.75,.12)],
            [(72,.25,.19),(76,1,.16),(79,2.5,.17)],[(74,.5,.17),(72,1.75,.14),(71,3,.12)],
            [(79,.25,.19),(81,1,.15),(79,2.5,.16)],[(77,.5,.16),(74,1.25,.15),(71,2.75,.13)],
            [(76,.25,.18),(79,1.5,.16),(76,2.25,.14)],[(77,.5,.17),(76,1.25,.14),(72,2.75,.15)],
            [(74,.25,.18),(77,1,.15),(81,2.5,.16)],[(79,.5,.17),(74,1.75,.14),(71,3,.12)],
            [(76,.25,.18),(74,1.5,.14),(72,2.5,.16)],[(74,.5,.16),(71,1.75,.12),(67,3,.10)]]
if RELAX:
    melody=[[(72,.25,.18),(74,2.5,.13)],[(74,.25,.16),(71,2.25,.12)],
            [(72,.5,.17),(76,2.5,.13)],[(76,.25,.16),(72,2.75,.12)],
            [(74,.5,.16),(72,2.5,.12)],[(71,.25,.15),(69,2.75,.11)],
            [(67,.5,.14),(72,2.25,.17)],[(74,.5,.15),(71,2.5,.11)],
            [(76,.25,.17),(74,2.5,.12)],[(74,.5,.15),(71,2.25,.12)],
            [(72,.25,.16),(76,2.75,.12)],[(77,.5,.15),(76,2.5,.11)],
            [(74,.25,.16),(72,2.5,.12)],[(71,.5,.15),(69,2.75,.10)],
            [(72,.25,.17),(74,2,.12),(72,3,.10)],[(71,.5,.13),(67,2.5,.10)]]
for bar,phrase in enumerate(melody):
    for midi,offset,velocity in phrase:add(midi,bar*4+offset,velocity,1.9 if RELAX else 1.35 if LIGHT else 2.4,.12)
accents=[(7.5,79),(23.5,76),(39.5,79),(55.5,76)] if RELAX else [(6.25,79),(14.4,76),(22.2,81),(38.3,79),(46.4,76),(54.2,81)]
for beat,midi in accents:add(midi,beat,.04 if RELAX else .055,2.1 if RELAX else 1.8 if LIGHT else 2.8,-.25,True)

# Circular reflections carry the same room tail across the loop boundary.
dry=mix.copy()
for seconds,gain in [(.071,.12),(.149,.085),(.233,.055),(.397,.035)]:
    mix+=np.roll(dry[:,::-1],round(seconds*RATE),axis=0)*gain
mix-=mix.mean(axis=0);rms=float(np.sqrt(np.mean(mix**2)));peak=float(np.max(np.abs(mix)))
mix*=min(.065/max(rms,1e-12),.48/max(peak,1e-12))
pcm=np.rint(np.clip(mix,-1,1)*32767).astype('<i2');raw=pcm.tobytes()
master=HERE/(f'cozy-window-v{VERSION}-master.wav' if VERSION>1 else 'cozy-window-master.wav')
with wave.open(str(master),'wb') as out:out.setnchannels(2);out.setsampwidth(2);out.setframerate(RATE);out.writeframes(raw)
encoder=lameenc.Encoder();encoder.set_bit_rate(64);encoder.set_in_sample_rate(RATE);encoder.set_channels(2);encoder.set_quality(2)
mp3=HERE/f'cozy-window-v{VERSION}.mp3';mp3.write_bytes(encoder.encode(raw)+encoder.flush())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
record={'title':TITLE,'version':VERSION,'durationSeconds':N/RATE,'bpm':BPM,'bars':BARS,'sampleRate':RATE,'channels':2,
 'origin':'Original algorithm-assisted composition and procedural modal synthesis. No external recordings or samples.',
 'instruments':['synthesized soft piano-like keys','sparse synthesized music-box accents'],'encoding':{'codec':'MP3','kbps':64,'encoder':'lameenc 1.9.0'},
 'peakDbfs':20*math.log10(float(np.max(np.abs(mix)))),'rmsDbfs':20*math.log10(float(np.sqrt(np.mean(mix**2)))),
 'files':[{'file':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in [master,mp3]],'notes':notes,'listeningApproved':False,'published':False}
(HERE/(f'manifest-v{VERSION}.json' if VERSION>1 else 'manifest.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({key:record[key] for key in ['title','durationSeconds','peakDbfs','rmsDbfs','files']},ensure_ascii=False))
