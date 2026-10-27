"""拼图小窝 BGM v2: quiet, sparse piano pieces in the spirit of sandbox-game ambient music.
Original composition; every sound is synthesized here (additive piano model, soft pad).
No samples, no recordings, no borrowed melodies.
Usage: python piano_suite.py <outdir>
"""
import json, math, sys, pathlib, wave
import numpy as np

RATE = 44100

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

# ---------------- instruments ----------------
def piano(m, vel, hold, rng):
    """Additive felt-piano model: stretched partials, two-stage decay, detuned unison, damper."""
    f0 = hz(m)
    B = 0.00022 * 2 ** ((m - 60) / 20)                 # inharmonicity grows with pitch
    Tf = 1.6 * 2 ** (-(m - 60) / 22)                   # prompt decay
    Ts = 7.5 * 2 ** (-(m - 60) / 26)                   # aftersound
    damp_at = hold
    L = int(min(hold + 0.6, 7 * Ts + 0.5) * RATE)
    t = np.arange(L) / RATE
    y = np.zeros(L)
    fc = 800 + 3200 * vel ** 1.3                       # soft hammers are dark
    n = 1
    while True:
        fn = n * f0 * math.sqrt(1 + B * n * n)
        if fn > 9000 or n > 28: break
        a = (1 / n ** 1.05) / (1 + (fn / fc) ** 2) ** 0.75 * (abs(math.sin(math.pi * n / 7)) + 0.15)
        if a < 0.002: n += 1; continue
        tf, ts = Tf / (1 + 0.32 * (n - 1)), Ts / (1 + 0.22 * (n - 1))
        Ln = min(L, int(6.5 * ts * RATE) + 1)
        tn = t[:Ln]
        env = 0.72 * np.exp(-tn / tf) + 0.28 * np.exp(-tn / ts)
        d = rng.uniform(0.08, 0.35) / 1200 * math.log(2)
        ph = rng.uniform(0, 2 * np.pi)
        y[:Ln] += a * env * 0.5 * (np.cos(2 * np.pi * fn * (1 + d) * tn + ph) + np.cos(2 * np.pi * fn * (1 - d) * tn + ph * 1.3))
        n += 1
    att = 1 - np.exp(-t / (0.0016 + 0.004 * (1 - vel)))
    noise = rng.standard_normal(L) * np.exp(-t / 0.005)
    noise = np.convolve(noise, np.ones(7) / 7, 'same') * 0.035 * vel
    damper = np.where(t > damp_at, np.exp(-(t - damp_at) / 0.16), 1.0)
    return (y * att + noise) * damper * vel

def pad(notes, dur, vel, rng):
    rel = 3.0; L = int((dur + rel) * RATE); t = np.arange(L) / RATE; y = np.zeros(L)
    for m in notes:
        f0 = hz(m)
        for det in (-0.004, 0.0, 0.0045):
            f = f0 * (1 + det); ph = rng.uniform(0, 2 * np.pi); k = 1
            while k * f < 2600 and k <= 10:
                y += (1 / k) / (1 + (k * f / 650) ** 2) * np.sin(2 * np.pi * k * f * t + ph * k); k += 1
    y /= len(notes) * 3
    env = (1 - np.exp(-t / 1.6)) * np.clip(1 - (t - dur) / rel, 0, 1) ** 2
    return y * env * vel * (1 + 0.06 * np.sin(2 * np.pi * 0.17 * t))

# ---------------- score helpers ----------------
class Piece:
    def __init__(self, bpm, bars, seed, tempo=None):
        self.rng = np.random.default_rng(seed)
        self.bpm, self.bars = bpm, bars
        # per-bar tempo factor (rubato): >1 = slower
        self.factor = np.ones(bars) if tempo is None else np.array(tempo)
        beat = 60 / bpm
        self.bar_start = np.concatenate([[0], np.cumsum(4 * beat * self.factor)])
        self.length = self.bar_start[-1]
        self.events = []   # (time_sec, kind, args)
    def time(self, bar, beat):
        b = int(bar); return self.bar_start[b] + beat * (60 / self.bpm) * self.factor[min(b, self.bars - 1)]
    def note(self, bar, beat, m, vel, hold_beats, pan=None, late=0.0):
        t = self.time(bar, beat) + late + self.rng.normal(0, 0.008)
        hold = hold_beats * 60 / self.bpm * self.factor[min(int(bar), self.bars - 1)]
        if pan is None: pan = max(-0.45, min(0.45, (m - 62) / 40))
        self.events.append((max(0.0, t), 'piano', (m, vel * self.rng.uniform(0.9, 1.06), hold, pan)))
    def chord_pad(self, bar, notes, bars, vel):
        dur = self.time(bar + bars, 0) - self.time(bar, 0)
        self.events.append((self.time(bar, 0), 'pad', (notes, dur, vel)))
    def melody(self, line, vel, octave=0, hold_extra=0.6):
        """line: list of (bar, beat, midi, beats)"""
        for bar, beat, m, d in line:
            self.note(bar, beat, m + octave, vel, d + hold_extra)

def render(piece, tail=7.0, rt60=3.6, wet=0.42, pad_send=0.7):
    N = int((piece.length + tail) * RATE)
    dry = np.zeros((N, 2)); send = np.zeros((N, 2))
    for t0, kind, args in sorted(piece.events, key=lambda e: e[0]):
        s = int(t0 * RATE)
        if kind == 'piano':
            m, vel, hold, pan = args; sig = piano(m, vel, hold, piece.rng); r = 0.55
        else:
            notes, dur, vel = args; sig = pad(notes, dur, vel, piece.rng); pan = 0.0; r = pad_send
        sig = sig[:N - s]; gl, gr = math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)
        dry[s:s + len(sig), 0] += sig * gl; dry[s:s + len(sig), 1] += sig * gr
        send[s:s + len(sig), 0] += sig * gl * r; send[s:s + len(sig), 1] += sig * gr * r
    # hall reverb: decaying filtered noise IR, linear convolution via FFT
    Lr = int((rt60 + 0.5) * RATE); tt = np.arange(Lr) / RATE; pre = int(0.022 * RATE)
    size = 1 << int(np.ceil(np.log2(N + Lr + pre)))
    wetsig = np.zeros((N, 2))
    for c in range(2):
        r = np.random.default_rng(31 + c).standard_normal(Lr) * np.exp(-6.9 * tt / rt60) * (1 - np.exp(-tt / 0.03))
        R = np.fft.rfft(np.concatenate([np.zeros(pre), r]), size)
        fr = np.fft.rfftfreq(size, 1 / RATE)
        R *= 1 / np.sqrt(1 + (fr / 4200) ** 2) * (1 - 1 / (1 + (fr / 150) ** 2))
        ir = np.fft.irfft(R, size); ir /= np.sqrt(np.sum(ir ** 2))
        wetsig[:, c] = np.fft.irfft(np.fft.rfft(send[:, c], size) * np.fft.rfft(ir, size), size)[:N]
    mix = dry + wet * wetsig
    X = np.fft.rfft(mix, axis=0); fr = np.fft.rfftfreq(N, 1 / RATE)
    X *= ((1 - 1 / (1 + (fr / 45) ** 4)) / np.sqrt(1 + (fr / 11000) ** 4))[:, None]
    mix = np.fft.irfft(X, n=N, axis=0)
    fade = int(1.5 * RATE); mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    mix /= np.max(np.abs(mix)) + 1e-9
    return mix * 10 ** (-1.0 / 20)

# =====================================================================
# 1. 晨光小窝 (Morning Nook) - E major, 64 BPM, broken chords + a few melody notes
# =====================================================================
def morning():
    rit = [1.0] * 24 + [1.04, 1.1, 1.18, 1.3]
    for i in (7, 15, 23): rit[i] = 1.07
    p = Piece(64, 28, 101, rit)
    S1 = [(40, [47, 56, 63, 66]), (40, [47, 56, 63, 66]), (33, [45, 52, 56, 59]), (33, [45, 52, 56, 59]),
          (37, [49, 52, 56, 63]), (44, [51, 54, 59, 63]), (33, [45, 52, 57, 59]), (35, [47, 52, 54, 59])]
    S2 = [(40, [47, 56, 63, 66]), (39, [47, 51, 54, 59]), (37, [49, 52, 56, 63]), (33, [45, 52, 56, 61]),
          (42, [49, 52, 57, 64]), (33, [45, 52, 57, 59]), (44, [47, 52, 56, 59]), (35, [47, 49, 54, 59])]
    END = [(33, [45, 52, 56, 59]), (33, [45, 48, 52, 54]), (40, [47, 56, 63, 66]), (40, [47, 52, 56, 63])]
    form = S1 + S2 + S1 + END
    for bar, (bass, ch) in enumerate(form):
        sec = bar // 8
        if bar >= 24: sec = 3
        v = 0.36 if sec != 2 else 0.30
        p.note(bar, 0, bass, v + 0.04, 4.2, pan=-0.3)               # low root, pedal through the bar
        if sec == 0:                                                # sparse: dyad on beat 3
            p.note(bar, 2, ch[1], v * 0.8, 2.2); p.note(bar, 2.04, ch[2], v * 0.75, 2.2)
        elif sec == 1:                                              # rolling quarter notes
            for k, b in enumerate((1, 2, 3)): p.note(bar, b, ch[k + 1], v * (0.85 - 0.06 * k), 3.2 - b)
        elif sec == 2:
            p.note(bar, 1, ch[0], v * 0.7, 3); p.note(bar, 2.5, ch[2], v * 0.65, 1.6)
        else:                                                       # ending: slow rolled chords
            for k, m in enumerate(ch): p.note(bar, k * 0.18, m, v * 0.75, 4.5)
    m1 = [(1, 1, 80, 1), (1, 2, 78, 1), (1, 3, 71, 2), (2, 2, 73, 1), (2, 3, 76, 1), (3, 0, 68, 2.5),
          (4, 1, 76, 1), (4, 2, 75, 1.5), (5, 0, 71, 2), (5, 2, 75, 1), (5, 3, 78, 1),
          (6, 0, 76, 1), (6, 1, 73, 1), (6, 2, 71, 2), (7, 0, 66, 3)]
    m2 = [(8, 0, 80, 2), (8, 2, 78, 1), (8, 3, 75, 1), (9, 0, 78, 3), (10, 1, 76, 1), (10, 2, 80, 1), (10, 3, 75, 1),
          (11, 0, 73, 3), (12, 1, 69, 1), (12, 2, 73, 1), (12, 3, 80, 1), (13, 0, 78, 1), (13, 1, 76, 1), (13, 2, 71, 2),
          (14, 0, 68, 1), (14, 1, 71, 1), (14, 2, 76, 2), (15, 0, 73, 3)]
    p.melody(m1, 0.42)
    p.melody(m2, 0.45)
    p.melody([(b + 16, beat, m, d) for b, beat, m, d in m1 if (b, beat) not in ((4, 2), (6, 1), (5, 3))], 0.30, octave=12, hold_extra=1.2)
    p.melody([(24, 0, 80, 2), (24, 2, 76, 2), (25, 0, 72, 2), (25, 2, 69, 2), (26, 0, 68, 4), (27, 0.9, 78, 4)], 0.36, hold_extra=1.5)
    return p, dict(rt60=3.4, wet=0.40)

# =====================================================================
# 2. 细雨 (Light Rain) - Bb major, 56 BPM, warm pad + single high notes
# =====================================================================
def rain():
    rit = [1.0] * 24 + [1.05, 1.12, 1.2, 1.35]
    for i in (7, 15): rit[i] = 1.06
    p = Piece(56, 28, 202, rit)
    S = [(46, [58, 62, 65, 69]), (43, [58, 62, 65, 69]), (39, [55, 58, 62, 67]), (39, [55, 58, 62, 67]),
         (38, [53, 58, 62, 65]), (36, [55, 58, 62, 63]), (39, [58, 62, 65, 67]), (41, [58, 60, 65, 69])]
    END = [(39, [55, 58, 62, 67]), (39, [54, 58, 60, 63]), (46, [58, 62, 65, 72]), (46, [58, 62, 65, 69])]
    form = S + S + S + END
    for bar, (bass, ch) in enumerate(form):
        sec = min(bar // 8, 3)
        p.chord_pad(bar, ch, 1, 0.16 if sec != 1 else 0.19)
        if bar % 2 == 0 or sec == 3: p.note(bar, 0, bass, 0.30, 7.5, pan=-0.3)
        if sec == 1: p.note(bar, 2, ch[1] + 12, 0.20, 2.5)
    m1 = [(1, 2, 74, 2), (2, 0, 79, 2), (2, 2, 77, 2), (3, 0, 74, 4), (4, 1, 77, 1), (4, 2, 82, 2),
          (5, 0, 79, 2), (5, 2, 75, 2), (6, 0, 77, 1), (6, 1, 74, 3), (7, 0, 72, 4)]
    m2 = [(8, 0, 81, 2), (8, 2, 77, 2), (9, 0, 82, 1), (9, 1, 81, 1), (9, 2, 77, 2), (10, 0, 79, 3), (10, 3, 82, 1),
          (11, 0, 86, 2), (11, 2, 84, 2), (12, 0, 82, 2), (12, 2, 77, 2), (13, 0, 79, 1), (13, 1, 75, 1), (13, 2, 74, 2),
          (14, 0, 77, 4), (15, 0, 75, 2), (15, 2, 72, 2)]
    p.melody(m1, 0.40, hold_extra=1.0)
    p.melody(m2, 0.43, hold_extra=0.8)
    p.melody([(b + 16, beat, m, d) for b, beat, m, d in m1 if b % 2 == 0 or beat == 0], 0.30, octave=-12, hold_extra=1.4)
    p.melody([(24, 0, 74, 4), (25, 0, 78, 2), (25, 2, 75, 2), (26, 0, 74, 4), (27, 0.5, 84, 4)], 0.36, hold_extra=2.0)
    return p, dict(rt60=4.0, wet=0.45)

# =====================================================================
# 3. 窗边星光 (Starlight by the Window) - G major, 70 BPM, open fifths + lydian shimmer
# =====================================================================
def starlight():
    rit = [1.0] * 20 + [1.04, 1.1, 1.2, 1.35]
    for i in (7, 15): rit[i] = 1.06
    p = Piece(70, 24, 303, rit)
    S1 = [(43, 55, 59), (36, 43, 52), (40, 47, 55), (38, 45, 54), (35, 43, 50), (36, 43, 55), (33, 40, 48), (38, 45, 54)]
    S2 = [(40, 47, 54), (36, 43, 52), (43, 50, 59), (42, 45, 50), (40, 47, 55), (36, 43, 55), (33, 40, 48), (38, 45, 54)]
    END = [(36, 43, 55), (36, 43, 51), (43, 50, 59), (43, 50, 55)]
    form = S1 + S2 + S1[:4] + END
    for bar, (r, fifth, top) in enumerate(form):
        sec = min(bar // 8, 2)
        v = 0.33 if sec != 2 else 0.27
        p.note(bar, 0, r, v, 2.4, pan=-0.3); p.note(bar, 0.03, fifth, v * 0.85, 2.4, pan=-0.2)
        p.note(bar, 2, top, v * 0.8, 2.3)
        if sec == 1: p.note(bar, 3, fifth + 12, v * 0.6, 1.3)
    m1 = [(0, 1, 74, 1), (0, 2, 71, 1), (0, 3, 74, 1), (1, 0, 76, 2), (1, 2, 78, 1), (1, 3, 76, 1), (2, 0, 71, 3), (2, 3, 67, 1),
          (3, 0, 69, 4), (4, 1, 74, 1), (4, 2, 71, 1), (4, 3, 79, 1), (5, 0, 78, 2), (5, 2, 76, 1), (5, 3, 74, 1),
          (6, 0, 72, 2), (6, 2, 76, 2), (7, 0, 74, 4)]
    m2 = [(8, 0, 79, 1.5), (8, 1.5, 78, 0.5), (8, 2, 71, 2), (9, 0, 76, 3), (9, 3, 74, 1), (10, 0, 71, 2), (10, 2, 74, 2),
          (11, 0, 81, 3), (11, 3, 78, 1), (12, 0, 79, 2), (12, 2, 83, 2), (13, 0, 81, 1), (13, 1, 79, 1), (13, 2, 76, 2),
          (14, 0, 72, 1), (14, 1, 76, 1), (14, 2, 79, 2), (15, 0, 78, 4)]
    p.melody(m1, 0.40)
    p.melody(m2, 0.42)
    p.melody([(b + 16, beat, m, d) for b, beat, m, d in m1 if b < 4 and beat in (0, 2)], 0.28, octave=12, hold_extra=1.5)
    p.melody([(20, 0, 76, 2), (20, 2, 79, 2), (21, 0, 75, 2), (21, 2, 79, 2), (22, 0, 71, 4), (23, 0.6, 86, 4)], 0.34, hold_extra=2.0)
    return p, dict(rt60=3.6, wet=0.42)

def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())

PIECES = {'morning': morning, 'rain': rain, 'starlight': starlight}
if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    only = sys.argv[2:] or list(PIECES)
    meta = {}
    for name in only:
        p, opts = PIECES[name]()
        x = render(p, **opts)
        write_wav(out / f'{name}-master.wav', x)
        meta[name] = {'bpm': p.bpm, 'bars': p.bars, 'seconds': round(len(x) / RATE, 2), 'notes': len(p.events)}
        print(name, meta[name], flush=True)
    (out / 'render.json').write_text(json.dumps(meta, indent=1))
