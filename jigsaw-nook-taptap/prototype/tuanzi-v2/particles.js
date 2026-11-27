// 「团子去旅行 2.0」窗外精准裁切天气粒子 + 屋内暖光浮尘 + 手势拂尘 + 抚摸反馈粒子引擎

export class NookAtmosphere {
  constructor(canvas, { onDustCleared } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onDustCleared = onDustCleared;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = 390;
    this.h = 844;
    this.weather = 'autumn';
    this.isEvolved = false;
    this.dustLevel = 0;
    this.lampGlow = null; // null | 'amber' | 'candle'
    this.hasJellyGlow = false;
    this.nightPreview = false;
    this.dustClearedNotified = false;
    this.running = false;
    this.rafId = 0;
    this.lastTime = 0;

    this.outdoor = [];
    this.dust = [];
    this.indoorMotes = [];
    this.bursts = [];

    this.resize(390, 844);
    this.initParticles();
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setScene({ weather, isEvolved, dustLevel, lampGlow = null, hasJellyGlow = false, nightPreview = false }) {
    const weatherChanged = weather !== this.weather;
    this.weather = weather || 'autumn';
    this.isEvolved = Boolean(isEvolved);
    this.lampGlow = lampGlow;
    this.hasJellyGlow = Boolean(hasJellyGlow);
    this.nightPreview = Boolean(nightPreview);
    if (dustLevel > 0.05 && this.dustLevel <= 0.05) {
      this.dustClearedNotified = false;
      this.seedDust(Math.round(48 * dustLevel));
    }
    this.dustLevel = dustLevel || 0;
    if (weatherChanged) this.seedOutdoor();
  }

  initParticles() {
    this.seedOutdoor();
    this.indoorMotes = Array.from({ length: 18 }, () => this.makeIndoorMote());
  }

  seedOutdoor() {
    const count = this.weather === 'snow' ? 62 : this.weather === 'rain' ? 48 : this.weather === 'sakura' ? 28 : 24;
    this.outdoor = Array.from({ length: count }, () => this.makeOutdoorParticle(true));
  }

  makeOutdoorParticle(randomY = false) {
    const far = Math.random() < 0.55;
    return {
      x: Math.random(),
      y: randomY ? Math.random() * 0.52 : -0.04,
      r: far ? 1.1 + Math.random() * 1.4 : 2.3 + Math.random() * 2.4,
      vy: far ? 0.032 + Math.random() * 0.028 : 0.055 + Math.random() * 0.045,
      vx: -0.012 + Math.random() * 0.024,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2.4,
      angle: Math.random() * Math.PI * 2,
      alpha: far ? 0.42 + Math.random() * 0.3 : 0.72 + Math.random() * 0.25,
      far,
    };
  }

  makeIndoorMote() {
    return {
      x: 0.04 + Math.random() * 0.78,
      y: 0.24 + Math.random() * 0.56,
      r: 0.9 + Math.random() * 1.6,
      vx: (Math.random() - 0.5) * 0.008,
      vy: -0.004 - Math.random() * 0.007,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.22 + Math.random() * 0.35,
    };
  }

  seedDust(count) {
    this.dust = Array.from({ length: count }, () => ({
      x: (0.08 + Math.random() * 0.84) * this.w,
      y: (0.18 + Math.random() * 0.62) * this.h,
      vx: (Math.random() - 0.5) * 6,
      vy: -3 - Math.random() * 5,
      r: 1.8 + Math.random() * 2.6,
      alpha: 0.45 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      swept: false,
    }));
  }

  /** 手势/鼠标轻滑拂去阳光金尘 */
  wipeAt(px, py) {
    if (this.dustLevel <= 0 || !this.dust.length) return 0;
    let hit = 0;
    for (const p of this.dust) {
      if (p.swept) continue;
      const dx = p.x - px;
      const dy = p.y - py;
      const d = Math.hypot(dx, dy);
      if (d < 56) {
        p.swept = true;
        const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.6;
        p.vx = Math.cos(ang) * (95 + Math.random() * 80);
        p.vy = Math.sin(ang) * (95 + Math.random() * 80) - 30;
        hit++;
      }
    }
    if (hit > 0) {
      const remaining = this.dust.filter(p => !p.swept).length;
      if (remaining <= Math.max(3, Math.floor(this.dust.length * 0.14)) && !this.dustClearedNotified) {
        this.dustClearedNotified = true;
        // Gently scatter the last few motes too
        for (const p of this.dust) {
          if (!p.swept) {
            p.swept = true;
            p.vx = (Math.random() - 0.5) * 110;
            p.vy = -50 - Math.random() * 60;
          }
        }
        this.onDustCleared?.();
      }
    }
    return hit;
  }

  /** 抚摸团子 / 收小鱼干 / 碰风铃 / 重逢欢庆的局部手绘粒子喷发 */
  spawnBurst(x, y, kind = 'pet') {
    const count = kind === 'reunion' ? 22 : kind === 'chime' ? 10 : 12;
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const spd = kind === 'reunion' ? 40 + Math.random() * 90 : 28 + Math.random() * 68;
      this.bursts.push({
        x: x + (Math.random() - 0.5) * 34,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 32,
        vy: Math.sin(ang) * spd - 16,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.65,
        size: kind === 'pet' ? 7 + Math.random() * 5 : 4 + Math.random() * 4,
        kind,
        rot: (Math.random() - 0.5) * 0.7,
      });
    }
  }

  /** 精准裁切到左木格窗玻璃与右木门玻璃格（雪/雨/樱花只在窗外飘落！） */
  applyWindowClip(ctx) {
    const w = this.w;
    const h = this.h;
    ctx.beginPath();
    if (this.isEvolved) {
      // Day 30 雪夜底图的左窗格与右门玻璃格
      ctx.rect(0, h * 0.078, w * 0.365, h * 0.352);
      ctx.rect(w * 0.852, h * 0.068, w * 0.148, h * 0.056);
      ctx.rect(w * 0.895, h * 0.180, w * 0.105, h * 0.248);
    } else {
      // Day 1 原地融合画板（left:-3px，完整露出左桌台灯与右书架）的左木格窗玻璃区域
      ctx.rect(w * 0.032, h * 0.214, w * 0.390, h * 0.278);
    }
    ctx.clip();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.tick(dt, now / 1000);
      this.render(now / 1000);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  tick(dt, t) {
    // 1. 窗外天气粒子更新
    for (const p of this.outdoor) {
      if (this.weather === 'rain') {
        p.y += p.vy * 8.2 * dt;
        p.x -= 0.14 * dt;
      } else if (this.weather === 'firefly') {
        p.x += Math.sin(t * 0.9 + p.phase) * 0.018 * dt;
        p.y += Math.cos(t * 0.7 + p.phase) * 0.014 * dt;
      } else if (this.weather === 'sakura' || this.weather === 'autumn') {
        p.y += p.vy * 0.85 * dt;
        p.x += (0.018 + Math.sin(t * 1.4 + p.phase) * 0.026) * dt;
        p.angle += p.spin * dt;
      } else {
        // snow / sun
        p.y += p.vy * dt;
        p.x += (p.vx + Math.sin(t * 1.15 + p.phase) * 0.018) * dt;
      }

      if (p.y > 0.50 || p.x < -0.05 || p.x > 1.05) {
        p.y = this.weather === 'firefly' ? 0.10 + Math.random() * 0.34 : 0.04;
        p.x = Math.random();
      }
    }

    // 2. 屋内柔和浮尘
    for (const m of this.indoorMotes) {
      m.x += (m.vx + Math.sin(t * 0.5 + m.phase) * 0.004) * dt;
      m.y += m.vy * dt;
      if (m.y < 0.16) {
        m.y = 0.78;
        m.x = 0.05 + Math.random() * 0.72;
      }
    }

    // 3. 久别可拂尘金尘
    for (let i = this.dust.length - 1; i >= 0; i--) {
      const d = this.dust[i];
      if (d.swept) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vx *= 0.96;
        d.vy *= 0.96;
        d.alpha -= 1.35 * dt;
        if (d.alpha <= 0.02) this.dust.splice(i, 1);
      } else {
        d.x += Math.sin(t * 0.7 + d.phase) * 6 * dt;
        d.y += Math.cos(t * 0.5 + d.phase) * 4 * dt;
      }
    }

    // 4. 交互喷发粒子
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      if (b.life >= b.maxLife) {
        this.bursts.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vy += (b.kind === 'pet' ? 18 : 36) * dt;
    }
  }

  render(t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.w, this.h);

    // A. 窗外精准裁切天气层（雪花/雨丝/樱花/秋叶/萤火）
    ctx.save();
    this.applyWindowClip(ctx);
    if (this.weather === 'snow') {
      // 柔和冬夜寒气罩层（使非雪夜底图切到雪天时也有真实雪意）
      if (!this.isEvolved) {
        ctx.fillStyle = 'rgba(34, 58, 96, 0.34)';
        ctx.fillRect(0, 0, this.w, this.h * 0.52);
      }
      for (const p of this.outdoor) {
        const px = p.x * this.w;
        const py = p.y * this.h;
        const g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 1.9);
        g.addColorStop(0, `rgba(255, 253, 248, ${p.alpha})`);
        g.addColorStop(0.55, `rgba(235, 244, 255, ${p.alpha * 0.6})`);
        g.addColorStop(1, 'rgba(235, 244, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, p.r * 1.9, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.weather === 'rain') {
      ctx.fillStyle = 'rgba(36, 54, 78, 0.24)';
      ctx.fillRect(0, 0, this.w, this.h * 0.52);
      ctx.lineWidth = 1.1;
      for (const p of this.outdoor) {
        const px = p.x * this.w;
        const py = p.y * this.h;
        ctx.strokeStyle = `rgba(222, 236, 252, ${p.alpha * 0.55})`;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 4, py + 15);
        ctx.stroke();
      }
    } else if (this.weather === 'sakura') {
      ctx.fillStyle = 'rgba(255, 224, 228, 0.14)';
      ctx.fillRect(0, 0, this.w, this.h * 0.52);
      for (const p of this.outdoor) {
        const px = p.x * this.w;
        const py = p.y * this.h;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.fillStyle = `rgba(255, 198, 208, ${p.alpha * 0.9})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.7, p.r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (this.weather === 'firefly') {
      for (const p of this.outdoor) {
        const px = p.x * this.w;
        const py = p.y * this.h;
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.8 + p.phase));
        const g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 3.4);
        g.addColorStop(0, `rgba(252, 248, 175, ${pulse * 0.9})`);
        g.addColorStop(1, 'rgba(210, 240, 120, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, p.r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // autumn / sun: 几片偶尔掠过窗外的温暖秋叶剪影
      for (let i = 0; i < Math.min(10, this.outdoor.length); i++) {
        const p = this.outdoor[i];
        const px = p.x * this.w;
        const py = p.y * this.h;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.angle);
        ctx.fillStyle = `rgba(228, 146, 68, ${p.alpha * 0.72})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 1.9, p.r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // B. 屋内台灯与水母瓶实时动态光晕（装扮换灯或试看雪夜时实时变色温！）
    const activeLamp = this.isEvolved ? 'amber' : this.lampGlow;
    if (activeLamp) {
      const pulse = 0.88 + 0.12 * Math.sin(t * (activeLamp === 'candle' ? 3.1 : 1.6));
      const lx = this.isEvolved ? this.w * 0.12 : this.w * 0.075;
      const ly = this.isEvolved ? this.h * 0.455 : this.h * 0.495;
      const radius = (this.nightPreview || this.isEvolved ? 175 : 132) * pulse;
      const alpha0 = this.nightPreview ? 0.38 : this.isEvolved ? 0.24 : 0.18;
      const g = ctx.createRadialGradient(lx, ly, 8, lx, ly, radius);
      if (activeLamp === 'candle') {
        g.addColorStop(0, `rgba(255, 198, 102, ${alpha0})`);
        g.addColorStop(0.5, `rgba(255, 158, 66, ${alpha0 * 0.38})`);
        g.addColorStop(1, 'rgba(255, 145, 50, 0)');
      } else {
        g.addColorStop(0, `rgba(255, 224, 144, ${alpha0})`);
        g.addColorStop(0.5, `rgba(255, 194, 104, ${alpha0 * 0.36})`);
        g.addColorStop(1, 'rgba(255, 180, 90, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.isEvolved || this.hasJellyGlow) {
      const jx = this.isEvolved ? this.w * 0.505 : this.w * 0.642;
      const jy = this.isEvolved ? this.h * 0.27 : this.h * 0.272;
      const jp = 0.78 + 0.22 * Math.sin(t * 2.1);
      const jr = (this.nightPreview ? 48 : 36) * jp;
      const jg = ctx.createRadialGradient(jx, jy, 2, jx, jy, jr);
      jg.addColorStop(0, `rgba(130, 218, 255, ${this.nightPreview ? 0.42 : 0.28})`);
      jg.addColorStop(1, 'rgba(130, 218, 255, 0)');
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.arc(jx, jy, jr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 柔和室内微尘
    for (const m of this.indoorMotes) {
      const px = m.x * this.w;
      const py = m.y * this.h;
      const a = m.alpha * (0.5 + 0.5 * Math.sin(t * 1.2 + m.phase));
      ctx.fillStyle = `rgba(255, 238, 196, ${a})`;
      ctx.beginPath();
      ctx.arc(px, py, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // C. 久别可手势拂去金尘
    for (const d of this.dust) {
      const pulse = 0.65 + 0.35 * Math.sin(t * 2.2 + d.phase);
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 2.6);
      g.addColorStop(0, `rgba(255, 242, 196, ${d.alpha * pulse})`);
      g.addColorStop(1, 'rgba(255, 224, 150, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // D. 抚摸 / 风铃 / 重逢喷发粒子（手绘感爪印与星辉）
    for (const b of this.bursts) {
      const k = 1 - b.life / b.maxLife;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.globalAlpha = Math.max(0, k);
      if (b.kind === 'pet') {
        // 小巧手绘暖红爪印/爱心点
        ctx.fillStyle = '#cf6352';
        ctx.beginPath();
        ctx.arc(0, 2, b.size * 0.42, 0, Math.PI * 2);
        ctx.arc(-b.size * 0.42, -b.size * 0.28, b.size * 0.19, 0, Math.PI * 2);
        ctx.arc(0, -b.size * 0.46, b.size * 0.2, 0, Math.PI * 2);
        ctx.arc(b.size * 0.42, -b.size * 0.28, b.size * 0.19, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 四芒暖金星辉
        ctx.fillStyle = b.kind === 'chime' ? '#a6d8e6' : '#ffe49e';
        const s = b.size;
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
        ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
        ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
        ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
