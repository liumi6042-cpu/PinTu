// 「团子去旅行 2.0」轻量治愈程序化 Web Audio 音效（零外部音频文件）

class CozySound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensure() {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tone(freq, dur, type = 'sine', vol = 0.08, delay = 0, slideTo = null) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 抚摸团子：温柔短喵 + 呼噜低鸣 */
  petCat() {
    this.tone(540, 0.16, 'triangle', 0.06, 0, 740);
    this.tone(740, 0.12, 'sine', 0.04, 0.11, 610);
    this.tone(110, 0.28, 'sine', 0.035, 0.05, 95);
  }

  /** 贝壳风铃：五声音阶清脆泛音 */
  windchime() {
    [1046, 1175, 1319, 1568, 1760].forEach((f, i) => {
      this.tone(f, 0.55, 'sine', 0.045, i * 0.075);
    });
  }

  /** 翻手账 / 折纸条 */
  paperTurn() {
    this.tone(240, 0.08, 'triangle', 0.04, 0, 170);
    this.tone(360, 0.06, 'sine', 0.025, 0.03, 260);
  }

  /** 收小鱼干 / 买东西 */
  fishChime() {
    this.tone(659, 0.16, 'triangle', 0.07, 0);
    this.tone(880, 0.24, 'triangle', 0.07, 0.09);
  }

  /** 盖火漆印 / 拼图块归位 */
  waxSnap() {
    this.tone(310, 0.09, 'triangle', 0.08, 0, 190);
    this.tone(520, 0.12, 'sine', 0.045, 0.04);
  }

  /** 显影拼图完成 / 拆重逢礼物 */
  celebrate() {
    [523, 659, 784, 1046].forEach((f, i) => {
      this.tone(f, 0.42, 'triangle', 0.065, i * 0.09);
    });
  }

  /** 奶奶的黄铜摇奖匣：胡桃木滚筒咔哒转动与木珠滚动声 */
  garaponCrank() {
    [220, 260, 210, 285, 240, 310, 265].forEach((f, i) => {
      this.tone(f, 0.065, 'triangle', 0.055, i * 0.095, f * 0.78);
    });
  }

  /** 木珠从黄铜滑道滚落托盘 */
  ballDrop(tier = 'green') {
    if (tier === 'gold') {
      [587, 740, 880, 1175, 1480].forEach((f, i) => this.tone(f, 0.55, 'triangle', 0.07, i * 0.08));
    } else if (tier === 'red') {
      [523, 659, 988].forEach((f, i) => this.tone(f, 0.42, 'sine', 0.065, i * 0.09));
    } else if (tier === 'blue') {
      [440, 587, 784].forEach((f, i) => this.tone(f, 0.34, 'triangle', 0.055, i * 0.08));
    } else {
      this.tone(420, 0.14, 'triangle', 0.06, 0, 560);
      this.tone(580, 0.22, 'sine', 0.05, 0.09);
    }
  }

  /** 三花猫黄铜八音盒：清脆五声摇篮旋律 */
  musicBox() {
    [784, 988, 1175, 988, 1319, 1175, 784].forEach((f, i) => {
      this.tone(f, 0.52, 'sine', 0.048, i * 0.15);
    });
  }

  /** 布置小窝摆件落位轻响 */
  decorSnap() {
    this.tone(280, 0.08, 'triangle', 0.07, 0, 200);
    this.tone(660, 0.22, 'sine', 0.045, 0.05);
  }
}

export const sound = new CozySound();
