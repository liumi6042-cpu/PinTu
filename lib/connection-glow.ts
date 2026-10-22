import { boardFor, pathFor, type Piece, type PuzzleState } from './puzzle-engine';
import { CONNECTION_GLOW_MS, MOBILE_CONNECTION_GLOW_MS, MOBILE_REDUCED_GLOW_MS, MobileContributionGate, connectionPath, type ConnectionGlow, type MobileConnectionGlow, type MobileContributionReceipt } from './connection-feedback';

type MobileStamp = { glow: MobileConnectionGlow; accent: HTMLSpanElement; x: number; y: number; reduced: boolean; local: boolean; scale: number };
type Flash = { canvas: HTMLCanvasElement; anchor: number; left: number; top: number; timer: ReturnType<typeof setTimeout>; mobile?: MobileStamp };

// Small stamps are painted once; CSS handles opacity and the few mobile sparks.
// No per-frame scene rendering, React updates, or touch targets are introduced.
export class ConnectionGlowRenderer {
 private flashes: Flash[] = [];
 private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
 private receipts = new MobileContributionGate();
 private host: HTMLElement; private state: PuzzleState; private pieces: Piece[]; private camera: () => { x: number; y: number; z: number }; private mobile: boolean;
 constructor(host: HTMLElement, state: PuzzleState, pieces: Piece[], camera: () => { x: number; y: number; z: number }, mobile = false) {
  this.host = host; this.state = state; this.pieces = pieces; this.camera = camera; this.mobile = mobile;
  document.addEventListener('visibilitychange', this.visibility);
  this.motion.addEventListener('change', this.clear);
 }
 private visibility = () => { if (document.hidden) this.clear(); };
 show(glows: ConnectionGlow[]) {
  if (document.hidden) return;
  const board = boardFor(this.state.cols, this.state.rows), w = board.width / this.state.cols, h = board.height / this.state.rows;
  for (const glow of glows) {
   const mobileGlow = this.mobile && 'outlineIds' in glow ? glow as MobileConnectionGlow : undefined;
   const ids = mobileGlow ? mobileGlow.outlineIds : glow.seams.map(s => s.pieceId);
   if (!ids.length || ids.some(id => !this.pieces[id])) continue;
   while (this.flashes.length >= 3) this.remove(this.flashes[0]);
   const pad = Math.min(w, h) * .28 + (mobileGlow ? 5 / Math.max(.15, this.camera().z) : 4), left = Math.min(...ids.map(id => this.pieces[id].col * w)) - pad, top = Math.min(...ids.map(id => this.pieces[id].row * h)) - pad;
   const width = Math.max(...ids.map(id => (this.pieces[id].col + 1) * w)) + pad - left, height = Math.max(...ids.map(id => (this.pieces[id].row + 1) * h)) + pad - top;
   const scale = Math.min(Math.max(1, this.camera().z) * Math.min(devicePixelRatio || 1, 2), 768 / Math.max(width, height));
   const canvas = document.createElement('canvas'); canvas.className = mobileGlow ? 'connection-glow mobile-snap-outline' : 'connection-glow'; canvas.setAttribute('aria-hidden', 'true');
   const reduced = !!mobileGlow && this.motion.matches;
   const duration = mobileGlow ? reduced ? MOBILE_REDUCED_GLOW_MS : MOBILE_CONNECTION_GLOW_MS : CONNECTION_GLOW_MS;
   canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; canvas.style.animationDuration = `${duration}ms`;
   const c = canvas.getContext('2d'); if (!c) continue;
   this.host.appendChild(canvas);
   const flash: Flash = { canvas, anchor: glow.anchor, left, top, timer: setTimeout(() => this.remove(flash), duration) };
   if (mobileGlow) {
    const accent = document.createElement('span'); accent.className = 'mobile-snap-accent'; accent.setAttribute('aria-hidden', 'true');
    const focus = this.pieces[mobileGlow.outlineIds[0]];
    flash.mobile = { glow: mobileGlow, accent, x: (focus.col + .5) * w, y: (focus.row + .5) * h, reduced, local: mobileGlow.source === 'local', scale };
    this.host.appendChild(accent); this.paintMobile(flash); this.addSparks(flash);
   } else {
    c.scale(scale, scale); c.translate(-left, -top); c.lineCap = 'round'; c.lineJoin = 'round';
    const line = Math.min(w, h) * .055 + .6;
    for (const seam of glow.seams) {
     const p = this.pieces[seam.pieceId], path = new Path2D(connectionPath(p, this.state.cols, this.state.rows, seam.side)); c.save(); c.translate(p.col * w, p.row * h);
     for (const [size, color] of [[line * 4, '#edbd6c22'], [line * 2.1, '#ffdf9b66'], [line * .7, '#fff2c9cc']] as const) { c.strokeStyle = color; c.lineWidth = size; c.stroke(path); } c.restore();
    }
   }
   this.flashes.push(flash);
  }
  this.update();
 }
 private paintMobile(flash: Flash) {
  const m = flash.mobile, c = flash.canvas.getContext('2d'); if (!m || !c) return;
  const board = boardFor(this.state.cols, this.state.rows), w = board.width / this.state.cols, h = board.height / this.state.rows;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, flash.canvas.width, flash.canvas.height);
  c.scale(m.scale, m.scale); c.translate(-flash.left, -flash.top); c.lineCap = 'round'; c.lineJoin = 'round';
  const line = 1.6 / Math.max(.15, this.camera().z);
  flash.canvas.className = `connection-glow mobile-snap-outline ${m.local ? 'is-local' : 'is-teammate'}${m.reduced ? ' is-reduced' : ''}`;
  for (const id of m.glow.outlineIds) {
   const piece = this.pieces[id]; c.save(); c.translate(piece.col * w, piece.row * h);
   const path = new Path2D(pathFor(piece, this.state.cols, this.state.rows));
   c.strokeStyle = m.local ? '#dab36466' : '#d5c39440'; c.lineWidth = line * 2.6; c.stroke(path);
   c.strokeStyle = m.local ? '#fff2bb' : '#e4d4a7b3'; c.lineWidth = line; c.stroke(path); c.restore();
  }
 }
 private addSparks(flash: Flash) {
  const m = flash.mobile; if (!m || !m.local || m.reduced || m.accent.querySelector('.mobile-snap-spark')) return;
  for (const [x, y] of [[-12, -9], [11, -12], [-9, 10], [13, 8]]) {
   const spark = document.createElement('i'); spark.className = 'mobile-snap-spark';
   spark.style.setProperty('--spark-x', `${x}px`); spark.style.setProperty('--spark-y', `${y}px`); m.accent.appendChild(spark);
  }
 }
 confirmContribution(receipt: MobileContributionReceipt) {
  if (!this.mobile || !this.pieces[receipt?.groupId] || !this.receipts.claim(receipt) || document.hidden) return;
  const group = this.state.groups.find(g => g.id === receipt.groupId || g.pieces.includes(receipt.groupId)); if (!group) return;
  const newest = [...this.flashes].reverse();
  let flash = newest.find(f => !!f.mobile && (f.anchor === receipt.groupId || f.mobile.glow.outlineIds.includes(receipt.groupId))) ?? newest.find(f => !!f.mobile && group.pieces.includes(f.anchor));
  if (!flash) {
   this.show([{ anchor: receipt.groupId, seams: [], outlineIds: [receipt.groupId], source: 'local' } as MobileConnectionGlow]);
   flash = this.flashes[this.flashes.length - 1];
  }
  if (!flash?.mobile) return;
  const m = flash.mobile;
  if (!m.local) { m.local = true; this.paintMobile(flash); this.addSparks(flash); }
  const label = document.createElement('span'); label.className = `mobile-snap-xp${m.reduced ? ' is-reduced' : ''}`; label.textContent = `+${receipt.creditedXp} XP`;
  // Only one text label per burst. A new real contribution can replace it; a
  // repeated receipt is rejected before reaching this point.
  m.accent.querySelector('.mobile-snap-xp')?.remove(); m.accent.appendChild(label);
  clearTimeout(flash.timer); const current = flash; flash.timer = setTimeout(() => this.remove(current), m.reduced ? MOBILE_REDUCED_GLOW_MS : MOBILE_CONNECTION_GLOW_MS);
  this.update();
 }
 update() {
  if (!this.flashes.length) return;
  const board = boardFor(this.state.cols, this.state.rows), camera = this.camera();
  for (const flash of [...this.flashes]) {
   const group = this.state.groups.find(g => g.pieces.includes(flash.anchor)); if (!group) { this.remove(flash); continue; }
   flash.canvas.style.transform = `translate(${camera.x + (board.x + group.dx + flash.left) * camera.z}px,${camera.y + (board.y + group.dy + flash.top) * camera.z}px) scale(${camera.z})`;
   if (flash.mobile) flash.mobile.accent.style.transform = `translate(${camera.x + (board.x + group.dx + flash.mobile.x) * camera.z}px,${camera.y + (board.y + group.dy + flash.mobile.y) * camera.z}px)`;
  }
 }
 private remove(flash: Flash) { clearTimeout(flash.timer); flash.canvas.remove(); flash.mobile?.accent.remove(); flash.canvas.width = 0; flash.canvas.height = 0; this.flashes = this.flashes.filter(f => f !== flash); }
 private clear = () => { for (const flash of [...this.flashes]) this.remove(flash); };
 destroy() { this.clear(); this.receipts.clear(); document.removeEventListener('visibilitychange', this.visibility); this.motion.removeEventListener('change', this.clear); }
}
