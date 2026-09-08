'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { PAPER_PIECE_PATH, reducedPaperMotion } from '@/lib/paper-interactions';
import HomeNavigation from './home-navigation';

export default function DreamIntro({ onEnter }: { onEnter: () => void }) {
  const scene = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const key = useRef<HTMLButtonElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const phaseRef = useRef('idle');
  const done = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const raf = useRef(0);
  const suppress = useRef(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [phase, setPhase] = useState('idle');
  const [near, setNear] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer);
    cancelAnimationFrame(raf.current);
  }, []);

  function finish() {
    if (done.current) return;
    done.current = true;
    for (const timer of timers.current) clearTimeout(timer);
    cancelAnimationFrame(raf.current);
    onEnter();
  }

  function enter(fromPiece = false) {
    if (phaseRef.current !== 'idle' || done.current) return;
    phaseRef.current = fromPiece ? 'snapping' : 'opening';
    setPhase(phaseRef.current);
    setDragging(false);
    setMessage('正在走进这段时光…');
    cancelAnimationFrame(raf.current);
    if (fromPiece && key.current && slot.current && stage.current) {
      const target = slot.current.getBoundingClientRect();
      const base = stage.current.getBoundingClientRect();
      key.current.classList.remove('is-dragging');
      key.current.style.transform = `translate(${target.left + target.width / 2 - base.left - key.current.offsetLeft - key.current.offsetWidth / 2}px,${target.top + target.height / 2 - base.top - key.current.offsetTop - key.current.offsetHeight / 2}px) rotate(0deg) scale(${target.width / key.current.offsetWidth})`;
    }
    if (reducedPaperMotion()) { finish(); return; }
    if (fromPiece) timers.current.push(setTimeout(() => {
      phaseRef.current = 'opening';
      setPhase('opening');
    }, 240));
    timers.current.push(setTimeout(finish, fromPiece ? 1560 : 1320));
  }

  function release(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
    const gesture = drag.current;
    if (!gesture || event.pointerId !== gesture.id) return;
    drag.current = null;
    suppress.current = gesture.moved;
    setDragging(false);
    event.currentTarget.classList.remove('is-dragging');
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    const piece = event.currentTarget.getBoundingClientRect();
    const target = slot.current?.getBoundingClientRect();
    if (!cancelled && gesture.moved && target && Math.hypot(
      piece.left + piece.width / 2 - target.left - target.width / 2,
      piece.top + piece.height / 2 - target.top - target.height / 2,
    ) < 76) enter(true);
    else {
      event.currentTarget.style.transform = '';
      setNear(false);
      if (gesture.moved) setMessage('把拼块拖到画中的缺口，或点击「进入选图」。');
    }
  }

  return <main ref={scene} className={`paper-entrance entrance-${phase}${dragging ? ' entrance-dragging' : ''}`} onPointerMove={event => {
    if (drag.current || phaseRef.current !== 'idle' || event.pointerType !== 'mouse' || reducedPaperMotion()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      scene.current?.style.setProperty('--entrance-x', String(x));
      scene.current?.style.setProperty('--entrance-y', String(y));
    });
  }} onPointerLeave={() => {
    if (!drag.current) {
      cancelAnimationFrame(raf.current);
      scene.current?.style.setProperty('--entrance-x', '0');
      scene.current?.style.setProperty('--entrance-y', '0');
    }
  }}>
    <header className="entrance-header">
      <a className="entrance-brand" href="/">一起拼图</a>
      <HomeNavigation />
    </header>

    <section className="entrance-copy">
      <p className="entrance-edition">01 首屏</p>
      <h1>把时光，<br />拼成喜欢的样子。</h1>
      <p className="entrance-subtitle">从一片开始，收集生活里的美好</p>
      <button className="entrance-enter" onClick={() => enter()} disabled={phase !== 'idle'}>
        {phase === 'idle' ? '进入选图' : '正在进入…'}<ArrowRight size={22} strokeWidth={1.3} />
      </button>
      <p className="entrance-note">无需登录，即刻开始</p>
    </section>

    <div className="entrance-stage" ref={stage}>
      <div className="entrance-camera" aria-hidden="true">
        <img className="entrance-scenery" src="/intro/hero-paper-coast-v2.png" alt="" fetchPriority="high" draggable={false} />
      </div>
      <div className={`entrance-slot${near ? ' is-near' : ''}`} ref={slot} aria-hidden="true">
        <svg viewBox="0 0 100 100"><path d={PAPER_PIECE_PATH} /></svg>
      </div>
      <button className="entrance-piece" ref={key} aria-label="拖动这块拼图到海岸画中的缺口，或点击进入选图" disabled={phase !== 'idle'}
        onClick={event => { if (event.detail === 0 || !suppress.current) enter(); }}
        onPointerDown={event => {
          if (event.button !== 0 || phaseRef.current !== 'idle' || drag.current) return;
          cancelAnimationFrame(raf.current);
          suppress.current = false;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add('is-dragging');
          setDragging(true);
        }}
        onPointerMove={event => {
          const gesture = drag.current;
          if (!gesture || gesture.id !== event.pointerId) return;
          const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
          gesture.moved ||= Math.hypot(dx, dy) > 5;
          event.currentTarget.style.transform = `translate(${dx}px,${dy}px) rotate(-12deg)`;
          const piece = event.currentTarget.getBoundingClientRect(), target = slot.current?.getBoundingClientRect();
          if (target) setNear(Math.hypot(piece.left + piece.width / 2 - target.left - target.width / 2, piece.top + piece.height / 2 - target.top - target.height / 2) < 76);
        }}
        onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}>
        <svg viewBox="0 0 100 100" aria-hidden="true"><path d={PAPER_PIECE_PATH} /></svg>
        <span className="entrance-piece-label">拿起这一片 ↗</span>
      </button>
    </div>

    <footer className="entrance-footer">
      <span role="status" aria-live="polite">{message}</span>
      <button onClick={finish}>跳过开场 →</button>
    </footer>
    <div className="entrance-wash" aria-hidden="true" />
  </main>;
}
