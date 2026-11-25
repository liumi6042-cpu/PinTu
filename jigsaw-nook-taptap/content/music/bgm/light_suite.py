"""拼图小窝 BGM v3: light, cheerful easy-listening pieces (major keys, bright timbres).
Original composition; every sound is synthesized here. No samples, no recordings.
Output file names stay bgm-morning / bgm-rain / bgm-starlight so the game code is unchanged.
Usage: python light_suite.py <outdir>
"""
import json, math, sys, pathlib, wave
import numpy as np

RATE = 44100
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------------- instruments ----------------
def piano(m, vel, hold, rng):
    """Bright, short-ringing additive piano."""
    f0 = hz(m); B = 0.0002 * 2 ** ((m - 60) / 20)
    Tf = 0.8 * 2 ** (-(m - 60) / 22); Ts = 3.2 * 2 ** (-(m - 60) / 26)
    L = int(min(hold + 0.35, 6 * Ts + 0.3) * RATE); t = np.arange(L) / RATE; y = np.zeros(L)
    fc = 1400 + 4200 * vel ** 1.2; n = 1
    while True:
        fn = n * f0 * math.sqrt(1 + B * n * n)
        if fn > 11000 or n > 24: break
        a = (1 / n ** 1.1) / (1 + (fn / fc) ** 2) ** 0.6 * (abs(math.sin(math.pi * n / 7)) + 0.15)
        tf, ts = Tf / (1 + 0.3 * (n - 1)), Ts / (1 + 0.22 * (n - 1))
        Ln = min(L, int(6 * ts * RATE) + 1); tn = t[:Ln]
        d = rng.uniform(0.1, 0.3) / 1200 * math.log(2); ph = rng.uniform(0, 2 * np.pi)
        y[:Ln] += a * (0.7 * np.exp(-tn / tf) + 0.3 * np.exp(-tn / ts)) * 0.5 * (np.cos(2 * np.pi * fn * (1 + d) * tn + ph) + np.cos(2 * np.pi * fn * (1 - d) * tn + ph))
        n += 1
    att = 1 - np.exp(-t / 0.0015)
    damper = np.where(t > hold, np.exp(-(t - hold) / 0.09), 1.0)
    return y * att * damper * vel

def flute(m, dur, vel, rng):
    f = hz(m); rel = 0.12; L = int((dur + rel) * RATE); t = np.arange(L) / RATE
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.3 * t) * np.clip((t - 0.2) / 0.3, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / RATE
    y = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph) + 0.02 * np.sin(4 * ph)
    br = np.convolve(rng.standard_normal(L), np.ones(12) / 12, 'same') * 0.035
    env = (1 - np.exp(-t / 0.035)) * (0.82 + 0.18 * np.exp(-t / 0.25)) * np.clip(1 - (t - dur) / rel, 0, 1) ** 2
    return (y + br) * env * vel

def pluck(m, dur, vel):
    """Nylon-guitar / pizzicato-like pluck, short and round."""
    f = hz(m); L = int((dur + 0.15) * RATE); t = np.arange(L) / RATE; y = np.zeros(L); n = 1
    tau0 = 0.9 * 2 ** (-(m - 48) / 30)
    while n * f < 6000 and n <= 14:
        y += (1 / n ** 1.3) * abs(math.sin(math.pi * n * 0.2) + 0.1) * np.sin(2 * np.pi * n * f * t) * np.exp(-t / (tau0 / (1 + 0.45 * (n - 1))))
        n += 1
    return y * (1 - np.exp(-t / 0.002)) * np.where(t > dur, np.exp(-(t - dur) / 0.05), 1.0) * vel

def glock(m, vel):
    f = hz(m); t = np.arange(int(1.6 * RATE)) / RATE
    y = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.7) + 0.32 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.2)
         + 0.11 * np.sin(2 * np.pi * f * 5.40 * t) * np.exp(-t / 0.07) + 0.04 * np.sin(2 * np.pi * f * 8.93 * t) * np.exp(-t / 0.03))
    return y * (1 - np.exp(-t / 0.0008)) * np.clip((1.6 - t) / 0.2, 0, 1) * vel

def shaker(vel, rng):
    t = np.arange(int(0.07 * RATE)) / RATE; n = rng.standard_normal(len(t)); n = np.diff(n, prepend=0)
    return n * (1 - np.exp(-t / 0.006)) * np.exp(-t / 0.018) * vel

def pad(notes, dur, vel, rng):
    rel = 0.8; L = int((dur + rel) * RATE); t = np.arange(L) / RATE; y = np.zeros(L)
    for m in notes:
        for det in (-0.003, 0.0035):
            f = hz(m) * (1 + det); ph = rng.uniform(0, 6.28); k = 1
            while k * f < 5000 and k <= 8:
                y += (1 / k) / (1 + (k * f / 1600) ** 2) * np.sin(2 * np.pi * k * f * t + ph * k); k += 1
    y /= len(notes) * 2
    return y * (1 - np.exp(-t / 0.35)) * np.clip(1 - (t - dur) / rel, 0, 1) * vel

# ---------------- score ----------------
class Piece:
    def __init__(self, bpm, beats_per_bar, bars, seed):
        self.rng = np.random.default_rng(seed); self.bpm, self.bpb, self.bars = bpm, beats_per_bar, bars
        self.beat = 60 / bpm; self.length = bars * beats_per_bar * self.beat; self.events = []
    def at(self, bar, beat): return (bar * self.bpb + beat) * self.beat + self.rng.normal(0, 0.005)
    def add(self, bar, beat, sig, pan=0.0, rev=0.3):
        self.events.append((max(0.0, self.at(bar, beat)), sig, pan, rev))
    def melody(self, bar0, bars, make, pan=0.05, rev=0.32):
        for b, notes in enumerate(bars):
            pos = 0.0
            for m, d in notes:
                if m is not None: self.add(bar0 + b, pos, make(m, d), pan=pan, rev=rev)
                pos += d
            assert abs(pos - self.bpb) < 1e-6, (bar0 + b, pos)

def render(p, rt60=1.8, wet=0.28, tail=3.5):
    N = int((p.length + tail) * RATE); dry = np.zeros((N, 2)); send = np.zeros((N, 2))
    for t0, sig, pan, rev in p.events:
        s = int(t0 * RATE); sig = sig[:N - s]; gl, gr = math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)
        for bus, g in ((dry, 1.0), (send, rev)):
            bus[s:s + len(sig), 0] += sig * gl * g; bus[s:s + len(sig), 1] += sig * gr * g
    Lr = int((rt60 + 0.3) * RATE); tt = np.arange(Lr) / RATE; pre = int(0.015 * RATE)
    size = 1 << int(np.ceil(np.log2(N + Lr + pre))); fr = np.fft.rfftfreq(size, 1 / RATE); wets = np.zeros((N, 2))
    for c in range(2):
        r = np.random.default_rng(41 + c).standard_normal(Lr) * np.exp(-6.9 * tt / rt60) * (1 - np.exp(-tt / 0.01))
        R = np.fft.rfft(np.concatenate([np.zeros(pre), r]), size) / np.sqrt(1 + (fr / 6500) ** 2) * (1 - 1 / (1 + (fr / 200) ** 2))
        ir = np.fft.irfft(R, size); ir /= np.sqrt(np.sum(ir ** 2))
        wets[:, c] = np.fft.irfft(np.fft.rfft(send[:, c], size) * np.fft.rfft(ir, size), size)[:N]
    mix = dry + wet * wets
    X = np.fft.rfft(mix, axis=0); f = np.fft.rfftfreq(N, 1 / RATE)
    X *= ((1 - 1 / (1 + (f / 70) ** 4)) / np.sqrt(1 + (f / 14000) ** 4))[:, None]   # no rumble, keep the air
    mix = np.fft.irfft(X, n=N, axis=0)
    fade = int(1.2 * RATE); mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    mix /= np.max(np.abs(mix)) + 1e-9; mix = np.tanh(1.2 * mix) / np.tanh(1.2)
    return mix * 10 ** (-1.0 / 20)

def arp(p, bar, voicing, vel, pattern=(0, 1, 2, 3, 2, 1, 2, 3), step=0.5):
    for k, idx in enumerate(pattern):
        acc = 1.0 if k % 4 == 0 else 0.8 if k % 2 == 0 else 0.68
        m = voicing[idx]; p.add(bar, k * step, piano(m, vel * acc * p.rng.uniform(0.92, 1.05), step * 1.6 * p.beat, p.rng), pan=-0.3 + 0.6 * (m - 50) / 24, rev=0.25)

# =====================================================================
# 1. 阳光午后 (bgm-morning) - D major, 96 BPM: flowing piano arpeggios, flute tune, glockenspiel
# =====================================================================
def sunny():
    p = Piece(96, 4, 40, 11)
    V = {'D': (50, [50, 57, 62, 66]), 'Bm': (47, [47, 54, 59, 62]), 'G': (43, [55, 59, 62, 67]), 'A': (45, [57, 61, 64, 69]),
         'F#m': (42, [54, 57, 61, 66]), 'Em': (40, [52, 59, 64, 67])}
    A = ['D', 'Bm', 'G', 'A', 'D', 'F#m', 'G', 'A']; B = ['G', 'A', 'F#m', 'Bm', 'Em', 'A', 'D', 'D']
    form = ['D', 'G', 'D', 'A'] + A + B + A + B + ['D', 'G', 'A', 'D']
    for bar, ch in enumerate(form):
        root, v = V[ch]; last = bar == len(form) - 1
        if last:
            for k, m in enumerate(v + [74]): p.add(bar, k * 0.12, piano(m, 0.32, 3.5 * p.beat, p.rng), rev=0.35)
        else: arp(p, bar, v, 0.26)
        if 4 <= bar < 36:
            mk = lambda m, d: pluck(m, d * p.beat * 0.9, 0.24)
            p.add(bar, 0, mk(root + (12 if root < 45 else 0), 1), pan=-0.15, rev=0.1)
            fifth = root + 7 + (12 if root < 45 else 0)
            p.add(bar, 2, mk(fifth - 12 if fifth > 55 else fifth, 1), pan=-0.15, rev=0.1)
            for e in range(8):
                p.add(bar, e * 0.5, shaker(0.05 if e % 2 else 0.032, p.rng), pan=0.35, rev=0.1)
    melA = [[(None, .5), (69, .5), (74, .5), (76, .5), (78, 1.5), (76, .5)], [(74, 1), (71, 1), (None, .5), (71, .5), (73, .5), (74, .5)],
            [(76, 1.5), (74, .5), (71, 1), (67, 1)], [(69, 3), (None, 1)],
            [(None, .5), (69, .5), (74, .5), (76, .5), (78, 1.5), (81, .5)], [(81, 1), (78, 1), (None, .5), (73, .5), (76, .5), (78, .5)],
            [(79, 1.5), (78, .5), (76, 1), (74, .5), (76, .5)], [(76, 2), (73, 1), (None, 1)]]
    melB = [[(71, 1), (74, 1), (79, 1.5), (78, .5)], [(76, 1), (73, 1), (69, 2)], [(73, 1), (78, 1), (81, 1.5), (78, .5)], [(78, 1), (74, 1), (71, 2)],
            [(71, 1), (76, 1), (79, 1), (78, .5), (76, .5)], [(76, 1.5), (78, .5), (73, 2)], [(74, 1), (78, 1), (81, 2)], [(78, 1), (74, 1), (None, 2)]]
    fl = lambda m, d: flute(m, d * p.beat * 0.94, 0.24, p.rng)
    gl = lambda v: (lambda m, d: glock(m + 12, v))
    p.melody(4, melA, fl); p.melody(12, melB, fl)
    p.melody(20, melA, fl); p.melody(20, melA, gl(0.07), pan=0.3, rev=0.4)
    p.melody(28, melB, gl(0.12), pan=0.2, rev=0.4)
    for bar in (13, 15, 17):   # little glockenspiel answers in the first B
        for k, m in enumerate((81, 85, 86)): p.add(bar, 3 + k * 0.33, glock(m, 0.06), pan=0.4, rev=0.45)
    p.add(39, 0.5, glock(86, 0.10), pan=0.3, rev=0.5)
    return p

# =====================================================================
# 2. 小花园 (bgm-rain) - F major, 108 BPM: bouncy plucks, staccato piano, glockenspiel/flute tune
# =====================================================================
def garden():
    p = Piece(108, 4, 36, 22)
    V = {'F': (41, [57, 60, 65]), 'C': (48, [55, 60, 64]), 'Dm': (50, [57, 62, 65]), 'Bb': (46, [58, 62, 65]),
         'Am': (45, [57, 60, 64]), 'Gm': (43, [55, 58, 62])}
    A = [['F'], ['C'], ['Dm'], ['Bb'], ['F'], ['C'], ['Bb', 'C'], ['F']]
    B = [['Bb'], ['C'], ['Am'], ['Dm'], ['Gm'], ['C'], ['F'], ['C']]
    form = [['F'], ['C']] + A + A + B + A + [['F'], ['F']]
    for bar, chords in enumerate(form):
        last = bar == len(form) - 1
        for i, ch in enumerate(chords):
            root, v = V[ch]; b0 = i * (4 / len(chords)); span = 4 / len(chords)
            if last:
                for k, m in enumerate([root + 12] + v + [77]): p.add(bar, k * 0.1, pluck(m, 2.5 * p.beat, 0.3), rev=0.3)
                continue
            p.add(bar, b0, pluck(root + 12 if root < 45 else root, 0.8 * p.beat, 0.26), pan=-0.2, rev=0.1)
            if span == 4: p.add(bar, 2, pluck(root + 7 + (12 if root < 45 else 0), 0.8 * p.beat, 0.21), pan=-0.2, rev=0.1)
            for off in ((1, 3) if span == 4 else (1,)):
                for k, m in enumerate(v): p.add(bar, b0 + off + k * 0.008, piano(m, 0.16, 0.3 * p.beat, p.rng), pan=0.1, rev=0.2)
        if 2 <= bar < 34:
            for e in range(8): p.add(bar, e * 0.5, shaker(0.045 if e % 2 else 0.028, p.rng), pan=0.4, rev=0.08)
    melA = [[(72, .5), (69, .5), (72, .5), (77, .5), (76, 1), (72, 1)], [(74, .5), (72, .5), (70, .5), (69, .5), (67, 2)],
            [(69, .5), (70, .5), (72, .5), (74, .5), (77, 1), (74, 1)], [(72, 1.5), (70, .5), (69, 2)],
            [(72, .5), (69, .5), (72, .5), (77, .5), (81, 1), (79, 1)], [(79, .5), (77, .5), (76, .5), (74, .5), (72, 2)],
            [(74, 1), (70, 1), (76, 1), (72, 1)], [(77, 2), (None, 2)]]
    melB = [[(74, 1), (77, 1), (81, 1.5), (79, .5)], [(79, 1), (76, 1), (72, 2)], [(72, 1), (76, 1), (81, 1.5), (79, .5)], [(77, 1), (74, 1), (69, 2)],
            [(70, 1), (74, 1), (79, 1), (77, .5), (74, .5)], [(76, 1), (79, 1), (72, 2)], [(77, 1.5), (76, .5), (74, .5), (72, .5), (69, 1)], [(67, 1), (72, 1), (76, 1), (None, 1)]]
    gl = lambda v, o=0: (lambda m, d: glock(m + o, v))
    fl = lambda m, d: flute(m, d * p.beat * 0.85, 0.17, p.rng)
    pn = lambda m, d: piano(m + 12, 0.30, d * p.beat * 0.9, p.rng)
    p.melody(2, melA, gl(0.16), pan=0.15, rev=0.35)
    p.melody(10, melA, fl)
    p.melody(18, melB, pn, pan=0.1, rev=0.3)
    p.melody(26, melA, fl); p.melody(26, melA, gl(0.07, 12), pan=0.3, rev=0.4)
    for k, m in enumerate((77, 81, 84, 89)): p.add(35, 0.6 + k * 0.25, glock(m, 0.09), pan=0.3, rev=0.45)
    return p

# =====================================================================
# 3. 晴空 (bgm-starlight) - G major waltz, 138 BPM: piano oom-pah-pah, flute, light strings
# =====================================================================
def clear_sky():
    p = Piece(138, 3, 72, 33)
    V = {'G': (43, [59, 62, 67]), 'Em': (40, [59, 64, 67]), 'C': (48, [60, 64, 67]), 'D': (50, [57, 62, 66]),
         'Bm': (47, [59, 62, 66]), 'Am': (45, [60, 64, 69])}
    A = ['G', 'G', 'Em', 'Em', 'C', 'C', 'D', 'D', 'G', 'G', 'Bm', 'Bm', 'C', 'D', 'G', 'G']
    B = ['C', 'C', 'D', 'D', 'Bm', 'Bm', 'Em', 'Em', 'Am', 'Am', 'D', 'D', 'G', 'Em', 'Am', 'D']
    form = ['G', 'C', 'G', 'D'] + A + B + A + B + ['G', 'C', 'D', 'G']
    for bar, ch in enumerate(form):
        root, v = V[ch]; last = bar == len(form) - 1
        if last:
            for k, m in enumerate([root + 12] + v + [79]): p.add(bar, k * 0.15, piano(m, 0.3, 2.8 * p.beat, p.rng), rev=0.35)
            p.add(bar, 0.6, glock(91, 0.08), pan=0.3, rev=0.5); continue
        b = root + 12 if root < 45 else root
        p.add(bar, 0, piano(b, 0.30, 0.95 * p.beat, p.rng), pan=-0.25, rev=0.2)
        for beat in (1, 2):
            for k, m in enumerate(v): p.add(bar, beat + k * 0.01, piano(m, 0.14 if beat == 1 else 0.12, 0.6 * p.beat, p.rng), pan=0.1, rev=0.22)
        if 20 <= bar < 36 or 52 <= bar < 68:
            p.add(bar, 0, pad([n + 12 for n in v], 3 * p.beat, 0.16, p.rng), rev=0.4)
    melA = [[(71, 2), (74, 1)], [(79, 3)], [(78, 1), (76, 1), (74, 1)], [(71, 3)], [(72, 2), (76, 1)], [(79, 2), (76, 1)], [(78, 1.5), (76, .5), (74, 1)], [(69, 3)],
            [(71, 2), (74, 1)], [(79, 2), (81, 1)], [(83, 1.5), (81, .5), (78, 1)], [(74, 3)], [(76, 1), (79, 1), (76, 1)], [(78, 1), (81, 1), (78, 1)], [(79, 3)], [(None, 3)]]
    melB = [[(76, 2), (79, 1)], [(84, 2), (83, 1)], [(81, 2), (78, 1)], [(74, 3)], [(78, 2), (81, 1)], [(83, 2), (81, 1)], [(79, 1.5), (78, .5), (76, 1)], [(71, 3)],
            [(72, 2), (76, 1)], [(81, 2), (79, 1)], [(78, 1), (76, 1), (74, 1)], [(78, 3)], [(79, 2), (74, 1)], [(76, 2), (71, 1)], [(72, 1), (76, 1), (81, 1)], [(78, 2), (None, 1)]]
    fl = lambda m, d: flute(m, d * p.beat * 0.93, 0.22, p.rng)
    p.melody(4, melA, fl); p.melody(20, melB, fl)
    p.melody(36, melA, lambda m, d: piano(m, 0.34, d * p.beat * 0.95, p.rng), pan=0.1, rev=0.3)
    p.melody(36, melA, lambda m, d: glock(m + 12, 0.05), pan=0.3, rev=0.4)
    p.melody(52, melB, fl); p.melody(52, melB, lambda m, d: glock(m + 12, 0.06), pan=0.3, rev=0.4)
    return p

def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())

PIECES = {'morning': sunny, 'rain': garden, 'starlight': clear_sky}
if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True); meta = {}
    for name in sys.argv[2:] or PIECES:
        p = PIECES[name](); x = render(p); write_wav(out / f'{name}-master.wav', x)
        meta[name] = {'bpm': p.bpm, 'beats_per_bar': p.bpb, 'bars': p.bars, 'seconds': round(len(x) / RATE, 2), 'events': len(p.events)}
        print(name, meta[name], flush=True)
    (out / 'render.json').write_text(json.dumps(meta, indent=1))
