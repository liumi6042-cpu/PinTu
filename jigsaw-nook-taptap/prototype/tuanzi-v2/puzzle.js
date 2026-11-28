// 「团子去旅行 2.0」独立全屏异形咬合拼图台引擎（24 片默认显影 / 解锁 48 片进阶挑战）
// 采用与《拼图小窝》主游戏 lib/puzzle-engine.ts 完全一致的三次贝塞尔凹凸咬合曲线！

export const PUZZLE_TIERS = {
  24: { count: 24, cols: 6, rows: 4, label: '24 片显影', rewardCoins: 30, rewardTickets: 1 },
  48: { count: 48, cols: 8, rows: 6, label: '48 片进阶', rewardCoins: 50, rewardTickets: 1 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 生成完全互锁的异形拼图拓扑（相邻边严格正负互补） */
export function buildJigsawPieces(cols, rows, seed) {
  const rand = mulberry32(seed);
  const pieces = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = row * cols + col;
      const top = row === 0 ? 0 : -pieces[id - cols].edges[2];
      const right = col === cols - 1 ? 0 : (rand() > 0.5 ? 1 : -1);
      const bottom = row === rows - 1 ? 0 : (rand() > 0.5 ? 1 : -1);
      const left = col === 0 ? 0 : -pieces[id - 1].edges[1];
      pieces.push({
        id,
        row,
        col,
        border: row === 0 || col === 0 || row === rows - 1 || col === cols - 1,
        edges: [top, right, bottom, left],
      });
    }
  }
  return pieces;
}

/** 绘制与主游戏 lib/puzzle-engine.ts 同源的圆润凹凸咬合路径 */
export function traceJigsawPath(ctx, edges, ox, oy, pw, ph) {
  const d = Math.min(pw, ph) * 0.23;
  const sides = [
    [0, 0, pw, 0, 0, -1],
    [pw, 0, 0, ph, 1, 0],
    [pw, ph, -pw, 0, 0, 1],
    [0, ph, 0, -ph, -1, 0],
  ];
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  for (let i = 0; i < 4; i++) {
    const [sx, sy, tx, ty, nx, ny] = sides[i];
    const sign = edges[i];
    const px = (t, v) => ox + sx + tx * t + nx * d * v * sign;
    const py = (t, v) => oy + sy + ty * t + ny * d * v * sign;
    if (!sign) {
      ctx.lineTo(px(1, 0), py(1, 0));
    } else {
      ctx.lineTo(px(0.32, 0), py(0.32, 0));
      ctx.bezierCurveTo(px(0.40, 0), py(0.40, 0), px(0.44, 0), py(0.44, 0), px(0.42, 0.16), py(0.42, 0.16));
      ctx.bezierCurveTo(px(0.30, 0.70), py(0.30, 0.70), px(0.36, 1.0), py(0.36, 1.0), px(0.50, 1.0), py(0.50, 1.0));
      ctx.bezierCurveTo(px(0.64, 1.0), py(0.64, 1.0), px(0.70, 0.70), py(0.70, 0.70), px(0.58, 0.16), py(0.58, 0.16));
      ctx.bezierCurveTo(px(0.56, 0), py(0.56, 0), px(0.60, 0), py(0.60, 0), px(0.68, 0), py(0.68, 0));
      ctx.lineTo(px(1, 0), py(1, 0));
    }
  }
  ctx.closePath();
}

/**
 * 挂载独立全屏异形拼图工作台
 * 支持：真实拖拽吸附、桌面自由暂存、底部木托盘异形缩略块、原图透视、仅看边角、提示归位、邮戳显影动效
 */
export function mountWorkbenchPuzzle({
  canvas,
  trayEl,
  imageSrc,
  seedKey = 'default',
  cols = 6,
  rows = 4,
  onSnap,
  onProgress,
  onComplete,
}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const total = cols * rows;
  const seed = hashString(`${seedKey}:${cols}x${rows}`);
  const topo = buildJigsawPieces(cols, rows, seed);

  // 画布逻辑尺寸（贴合 390px 竖屏舞台，最大视野给 3:2 明信片画框）
  let stageW = 390;
  let stageH = 446;
  let board = { x: 15, y: 86, w: 360, h: 240 };
  let pw = board.w / cols;
  let ph = board.h / rows;
  let tabPad = Math.ceil(Math.min(pw, ph) * 0.28) + 4;

  let img = null;
  let imgReady = false;
  let spriteCache = new Map();
  let ghostOpacity = 0; // 不显示透视底图，仅保留淡雅咬合线底纹
  let edgeOnly = false;
  let solved = false;
  let destroyed = false;
  let rafId = 0;

  // 状态：每块拼图位于 'tray' | 'table' | 'locked'
  const rng = mulberry32(seed ^ 0x9E3779B9);
  const shuffledIds = topo.map(p => p.id);
  for (let i = shuffledIds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledIds[i], shuffledIds[j]] = [shuffledIds[j], shuffledIds[i]];
  }

  const pieces = topo.map(p => ({
    ...p,
    zone: 'tray', // 'tray' | 'table' | 'locked'
    x: 0,
    y: 0,
    z: 0,
  }));
  let zCounter = 1;
  let drag = null; // { piece, pointerId, offsetX, offsetY, fromTray }
  let flashes = []; // { x, y, w, h, edges, startedAt }
  let sparkles = []; // { x, y, vx, vy, life, maxLife, size }
  let flying = []; // { piece, sx, sy, ex, ey, startedAt, duration }

  function recomputeLayout() {
    const rect = canvas.parentElement?.getBoundingClientRect();
    stageW = Math.max(320, Math.round(rect?.width || 390));
    stageH = Math.max(340, Math.round(rect?.height || 446));
    canvas.width = Math.round(stageW * dpr);
    canvas.height = Math.round(stageH * dpr);
    canvas.style.width = `${stageW}px`;
    canvas.style.height = `${stageH}px`;

    const maxW = stageW - 26;
    const maxH = stageH - 118;
    const bw = Math.min(maxW, Math.round(maxH * 1.5));
    const bh = Math.round(bw * (rows / cols) * ((cols / rows) / 1.5));
    // 严格保持 3:2 明信片比例（6×4 与 8×6 恰好均为 3:2！）
    const finalW = Math.min(maxW, Math.round(maxH * 1.5));
    const finalH = Math.round(finalW * (2 / 3));
    board = {
      x: Math.round((stageW - finalW) / 2),
      y: Math.round((stageH - finalH) / 2) - 8,
      w: finalW,
      h: finalH,
    };
    pw = board.w / cols;
    ph = board.h / rows;
    tabPad = Math.ceil(Math.min(pw, ph) * 0.28) + 4;

    // 同步已锁定块坐标
    for (const p of pieces) {
      if (p.zone === 'locked') {
        p.x = board.x + p.col * pw;
        p.y = board.y + p.row * ph;
      }
    }
    if (imgReady) buildPieceSprites();
  }

  function buildPieceSprites() {
    spriteCache.clear();
    const cw = Math.ceil((pw + tabPad * 2) * dpr);
    const ch = Math.ceil((ph + tabPad * 2) * dpr);
    const sxScale = img.naturalWidth / board.w;
    const syScale = img.naturalHeight / board.h;

    for (const p of pieces) {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d');
      g.scale(dpr, dpr);

      g.save();
      traceJigsawPath(g, p.edges, tabPad, tabPad, pw, ph);
      g.clip();
      // 绘制对应原图切片（cover 裁切到 3:2 画框）
      const drawX = tabPad - p.col * pw;
      const drawY = tabPad - p.row * ph;
      g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, drawX, drawY, board.w, board.h);

      // 立体纸板微高光与内阴影，带来真实厚木卡纸手感
      g.strokeStyle = 'rgba(255, 248, 232, 0.42)';
      g.lineWidth = 1.6;
      traceJigsawPath(g, p.edges, tabPad + 0.6, tabPad + 0.6, pw, ph);
      g.stroke();
      g.restore();

      g.strokeStyle = 'rgba(66, 39, 22, 0.56)';
      g.lineWidth = 1.05;
      traceJigsawPath(g, p.edges, tabPad, tabPad, pw, ph);
      g.stroke();

      spriteCache.set(p.id, c);
    }
  }

  function spawnSnapBurst(cx, cy, count = 14) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const spd = 28 + Math.random() * 68;
      sparkles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        maxLife: 0.48 + Math.random() * 0.34,
        size: 3.5 + Math.random() * 3.5,
      });
    }
  }

  function lockedCount() {
    return pieces.filter(p => p.zone === 'locked').length;
  }

  function notifyProgress() {
    onProgress?.(lockedCount(), total);
  }

  function lockPiece(p, silent = false) {
    p.zone = 'locked';
    p.x = board.x + p.col * pw;
    p.y = board.y + p.row * ph;
    flashes.push({
      x: p.x,
      y: p.y,
      w: pw,
      h: ph,
      edges: p.edges,
      startedAt: performance.now(),
    });
    spawnSnapBurst(p.x + pw * 0.5, p.y + ph * 0.5, 12);
    if (!silent) onSnap?.();
    renderTray();
    notifyProgress();

    if (!solved && lockedCount() === total) {
      solved = true;
      spawnSnapBurst(board.x + board.w * 0.5, board.y + board.h * 0.5, 28);
      setTimeout(() => {
        if (!destroyed) onComplete?.();
      }, 520);
    }
  }

  /** 渲染底部木托盘中的真实凹凸异形拼图块 */
  function renderTray() {
    if (!trayEl) return;
    const inTray = shuffledIds
      .map(id => pieces[id])
      .filter(p => p.zone === 'tray' && (!edgeOnly || p.border));

    if (!inTray.length) {
      trayEl.innerHTML = `<div class="wb-tray-empty">${
        lockedCount() === total
          ? '全部拼图块已归位！'
          : edgeOnly
            ? '所有边角块已取出，关闭「仅看边角」继续拼中间块吧'
            : '托盘已空，把桌面上的散片拼回画框吧'
      }</div>`;
      return;
    }

    trayEl.innerHTML = '';
    const thumbSize = cols >= 8 ? 58 : 66;
    for (const p of inTray) {
      const btn = document.createElement('div');
      btn.className = `wb-tray-cell${p.border ? ' is-border' : ''}`;
      btn.dataset.pieceId = String(p.id);

      const tc = document.createElement('canvas');
      tc.width = Math.round(thumbSize * dpr);
      tc.height = Math.round(thumbSize * dpr);
      tc.style.width = `${thumbSize}px`;
      tc.style.height = `${thumbSize}px`;
      const tg = tc.getContext('2d');
      tg.scale(dpr, dpr);

      const sp = spriteCache.get(p.id);
      if (sp) {
        const spW = pw + tabPad * 2;
        const spH = ph + tabPad * 2;
        const scale = Math.min((thumbSize - 6) / spW, (thumbSize - 6) / spH);
        const dw = spW * scale;
        const dh = spH * scale;
        tg.shadowColor = 'rgba(34, 18, 8, 0.35)';
        tg.shadowBlur = 4;
        tg.shadowOffsetY = 2;
        tg.drawImage(sp, (thumbSize - dw) / 2, (thumbSize - dh) / 2, dw, dh);
      }

      btn.appendChild(tc);
      btn.addEventListener('pointerdown', (e) => {
        if (solved || !imgReady) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        p.zone = 'table';
        p.z = ++zCounter;
        // 拖拽起点在指尖上方微偏，避免手指遮挡拼图块
        p.x = cx - pw * 0.5;
        p.y = Math.min(cy - ph * 0.65, stageH - ph * 0.6);
        drag = {
          piece: p,
          pointerId: e.pointerId,
          offsetX: pw * 0.5,
          offsetY: ph * 0.65,
          fromTray: true,
          startX: e.clientX,
          startY: e.clientY,
          moved: false,
        };
        renderTray();
      });
      trayEl.appendChild(btn);
    }
  }

  function hitTablePiece(cx, cy) {
    const tablePieces = pieces
      .filter(p => p.zone === 'table')
      .sort((a, b) => b.z - a.z);
    for (const p of tablePieces) {
      if (cx >= p.x - tabPad * 0.5 && cx <= p.x + pw + tabPad * 0.5 && cy >= p.y - tabPad * 0.5 && cy <= p.y + ph + tabPad * 0.5) {
        return p;
      }
    }
    return null;
  }

  function onCanvasPointerDown(e) {
    if (solved || !imgReady) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const hit = hitTablePiece(cx, cy);
    if (!hit) return;
    e.preventDefault();
    hit.z = ++zCounter;
    drag = {
      piece: hit,
      pointerId: e.pointerId,
      offsetX: cx - hit.x,
      offsetY: cy - hit.y,
      fromTray: false,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  }

  function onWindowPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6) {
      drag.moved = true;
    }
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    drag.piece.x = cx - drag.offsetX;
    drag.piece.y = cy - drag.offsetY;
  }

  function onWindowPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { piece: p, fromTray, moved } = drag;
    drag = null;

    // 轻点托盘块（未拖动）：自动把该块放到桌面空白处方便查看
    if (fromTray && !moved) {
      p.x = Math.max(12, Math.min(stageW - pw - 12, board.x + (rng() * (board.w - pw))));
      p.y = stageH - ph - 12;
      return;
    }

    // 检查是否拖回底部托盘区域
    const rect = canvas.getBoundingClientRect();
    const cy = e.clientY - rect.top;
    if (cy > stageH + 8) {
      p.zone = 'tray';
      renderTray();
      return;
    }

    // 磁吸判定：距离正确格位 <= 0.44 * min(pw, ph) 立即丝滑吸附归位！
    const targetX = board.x + p.col * pw;
    const targetY = board.y + p.row * ph;
    const snapTol = Math.min(pw, ph) * 0.44;
    if (Math.hypot(p.x - targetX, p.y - targetY) <= snapTol) {
      lockPiece(p);
      return;
    }

    // 留在工作台桌面内（避免拖出视口丢失）
    p.x = Math.max(6, Math.min(stageW - pw - 6, p.x));
    p.y = Math.max(6, Math.min(stageH - ph - 6, p.y));
  }

  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
  window.addEventListener('pointercancel', onWindowPointerUp);

  let lastFrame = performance.now();
  function renderLoop(now) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    // 更新飞行提示块
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i];
      const u = Math.min(1, (now - f.startedAt) / f.duration);
      const ease = 1 - Math.pow(1 - u, 3);
      f.piece.x = f.sx + (f.ex - f.sx) * ease;
      f.piece.y = f.sy + (f.ey - f.sy) * ease;
      if (u >= 1) {
        flying.splice(i, 1);
        lockPiece(f.piece);
      }
    }

    // 更新吸附粒子
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.life += dt;
      if (s.life >= s.maxLife) {
        sparkles.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.94;
      s.vy *= 0.94;
    }
    flashes = flashes.filter(f => now - f.startedAt < 520);

    // 开始绘制
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, stageW, stageH);

    // 1. 画框木底槽（暖胡桃木内嵌相框）
    ctx.save();
    ctx.shadowColor = 'rgba(20, 10, 4, 0.42)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#4e3120';
    ctx.beginPath();
    ctx.roundRect(board.x - 7, board.y - 7, board.w + 14, board.h + 14, 10);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#f3e7d1';
    ctx.fillRect(board.x, board.y, board.w, board.h);

    // 2. 原图透视底稿（柔和复古淡影）
    if (imgReady) {
      if (solved) {
        ctx.drawImage(img, board.x, board.y, board.w, board.h);
      } else {
        if (ghostOpacity > 0) {
          ctx.save();
          ctx.globalAlpha = ghostOpacity;
          ctx.drawImage(img, board.x, board.y, board.w, board.h);
          ctx.restore();
        }
        // 极轻盈的异形咬合线参考底纹（清晰又不喧宾夺主）
        ctx.save();
        ctx.strokeStyle = 'rgba(128, 92, 62, 0.22)';
        ctx.lineWidth = 0.85;
        for (const p of pieces) {
          traceJigsawPath(ctx, p.edges, board.x + p.col * pw, board.y + p.row * ph, pw, ph);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 3. 已归位拼图块（未全解时逐片渲染，全解后融合无接缝！）
    if (imgReady && !solved) {
      for (const p of pieces) {
        if (p.zone !== 'locked') continue;
        const sp = spriteCache.get(p.id);
        if (sp) ctx.drawImage(sp, p.x - tabPad, p.y - tabPad, pw + tabPad * 2, ph + tabPad * 2);
      }
    }

    // 4. 吸附瞬间暖金高光闪烁
    for (const f of flashes) {
      const k = 1 - (now - f.startedAt) / 520;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 226, 134, ${k * 0.95})`;
      ctx.lineWidth = 3 * k + 1;
      ctx.fillStyle = `rgba(255, 236, 168, ${k * 0.36})`;
      traceJigsawPath(ctx, f.edges, f.x, f.y, f.w, f.h);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 5. 桌面上自由摆放的未归位拼图块（按层级绘制，拖拽中微微浮起带投影！）
    if (imgReady) {
      const loose = pieces
        .filter(p => p.zone === 'table')
        .sort((a, b) => a.z - b.z);
      for (const p of loose) {
        const isHeld = drag?.piece === p;
        const sp = spriteCache.get(p.id);
        if (!sp) continue;
        ctx.save();
        const cx = p.x + pw * 0.5;
        const cy = p.y + ph * 0.5;
        ctx.translate(cx, cy);
        if (isHeld) {
          ctx.scale(1.08, 1.08);
          ctx.shadowColor = 'rgba(24, 12, 4, 0.52)';
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 7;
        } else {
          ctx.shadowColor = 'rgba(24, 12, 4, 0.34)';
          ctx.shadowBlur = 6;
          ctx.shadowOffsetY = 3;
        }
        ctx.drawImage(sp, -pw * 0.5 - tabPad, -ph * 0.5 - tabPad, pw + tabPad * 2, ph + tabPad * 2);
        ctx.restore();
      }
    }

    // 6. 四芒星辉粒子
    for (const s of sparkles) {
      const k = 1 - s.life / s.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = '#ffe394';
      ctx.translate(s.x, s.y);
      const r = s.size;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.2, r, 0);
      ctx.quadraticCurveTo(r * 0.2, r * 0.2, 0, r);
      ctx.quadraticCurveTo(-r * 0.2, r * 0.2, -r, 0);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.2, 0, -r);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    rafId = requestAnimationFrame(renderLoop);
  }

  // 加载明信片原图并构建异形切片缓存
  recomputeLayout();
  img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (destroyed) return;
    imgReady = true;
    buildPieceSprites();
    renderTray();
    notifyProgress();
  };
  img.src = imageSrc;
  rafId = requestAnimationFrame(renderLoop);

  /** 自动飞入归位 N 块（优先边角块，用于免费提示 / 激励视频提示） */
  function placeHintPieces(count = 1) {
    if (solved || !imgReady) return 0;
    const flyingSet = new Set(flying.map(f => f.piece.id));
    const candidates = pieces
      .filter(p => p.zone !== 'locked' && !flyingSet.has(p.id) && drag?.piece !== p)
      .sort((a, b) => Number(b.border) - Number(a.border));
    const picked = candidates.slice(0, count);
    picked.forEach((p, idx) => {
      const sx = p.zone === 'table' ? p.x : board.x + board.w * 0.5 - pw * 0.5;
      const sy = p.zone === 'table' ? p.y : stageH - 12;
      p.zone = 'table';
      p.z = ++zCounter;
      p.x = sx;
      p.y = sy;
      flying.push({
        piece: p,
        sx,
        sy,
        ex: board.x + p.col * pw,
        ey: board.y + p.row * ph,
        startedAt: performance.now() + idx * 140,
        duration: 380,
      });
    });
    renderTray();
    return picked.length;
  }

  return {
    setGhostMode(nextOpacity) {
      ghostOpacity = nextOpacity;
    },
    getGhostOpacity() {
      return ghostOpacity;
    },
    setEdgeOnly(flag) {
      edgeOnly = Boolean(flag);
      renderTray();
    },
    hint(count = 1) {
      return placeHintPieces(count);
    },
    autoSolve() {
      if (solved || !imgReady) return;
      flying = [];
      drag = null;
      for (const p of pieces) {
        if (p.zone !== 'locked') {
          p.zone = 'locked';
          p.x = board.x + p.col * pw;
          p.y = board.y + p.row * ph;
        }
      }
      solved = true;
      renderTray();
      notifyProgress();
      onSnap?.();
      spawnSnapBurst(board.x + board.w * 0.5, board.y + board.h * 0.5, 28);
      setTimeout(() => {
        if (!destroyed) onComplete?.();
      }, 420);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('pointercancel', onWindowPointerUp);
      spriteCache.clear();
    },
  };
}
