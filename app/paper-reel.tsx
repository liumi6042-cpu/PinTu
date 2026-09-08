'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useCallback, useEffect, useRef } from 'react';
import { clamp, reelDestination, reducedPaperMotion, wrapPhoto } from '@/lib/paper-interactions';
import type { PHOTOS } from '@/lib/puzzle-catalog';
type Photo = typeof PHOTOS[number];
type Props = {
    photos: Photo[];
    index: number;
    onIndex: (index: number) => void;
    disabled: boolean;
    pullLabel: string;
    onStart: () => void;
};
export default function PaperReel({ photos, index, onIndex, disabled, pullLabel, onStart }: Props) {
    useLanguage();
    const track = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), frames = useRef<(HTMLDivElement | null)[]>([]);
    const props = useRef({ photos, index, onIndex, disabled, onStart });
    props.current = { photos, index, onIndex, disabled, onStart };
    const position = useRef(index), reported = useRef(index), width = useRef(244), raf = useRef(0), wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null), suppress = useRef(false);
    const gesture = useRef<{
        id: number;
        x: number;
        y: number;
        start: number;
        lastX: number;
        time: number;
        velocity: number;
        kind: 'reel' | 'pull';
        moved: boolean;
        amount: number;
    } | null>(null);
    const ids = photos.map(photo => photo.id).join('|');
    const stop = useCallback(() => { cancelAnimationFrame(raf.current); raf.current = 0; if (wheelTimer.current)
        clearTimeout(wheelTimer.current); wheelTimer.current = null; }, []);
    const draw = useCallback(() => {
        const node = track.current;
        if (!node || !props.current.photos.length)
            return;
        width.current = Math.min(292, Math.max(154, node.clientWidth * .35));
        const base = Math.round(position.current), single = props.current.photos.length === 1, radius = width.current / .62;
        frames.current.forEach((el, i) => { if (!el)
            return; const logical = base + i - 3, offset = logical - position.current, angle = offset * .62, photo = props.current.photos[wrapPhoto(logical, props.current.photos.length)]; el.style.width = width.current + 'px'; el.style.height = width.current * .75 + 38 + 'px'; el.style.transform = `translate(-50%,-50%) translateX(${Math.sin(angle) * radius}px) translateZ(${(Math.cos(angle) - 1) * radius}px) rotateY(${-angle}rad)`; el.style.opacity = String(single ? (i === 3 ? 1 : 0) : clamp(1 - (Math.abs(offset) - 1.65) * .85, 0, 1)); el.style.zIndex = String(12 - Math.round(Math.abs(offset) * 2)); el.classList.toggle('is-selected', Math.abs(offset) < .5); const img = el.querySelector('img')!; if (img.getAttribute('src') !== photo.src)
            img.src = photo.src; });
        stage.current?.style.setProperty('--paper-card-bottom', `${width.current * .375 + 19}px`);
        if (base !== reported.current) {
            reported.current = base;
            props.current.onIndex(base);
        }
    }, []);
    const settle = useCallback((target: number) => {
        stop();
        if (props.current.photos.length < 2) {
            position.current = 0;
            draw();
            return;
        }
        const from = position.current, change = target - from;
        if (reducedPaperMotion()) {
            position.current = target;
            draw();
            return;
        }
        const start = performance.now(), duration = clamp(430 + Math.abs(change) * 95, 430, 1000);
        const step = (now: number) => { const t = clamp((now - start) / duration, 0, 1); position.current = from + change * (1 - (1 - t) ** 3); draw(); if (t < 1)
            raf.current = requestAnimationFrame(step);
        else
            raf.current = 0; };
        raf.current = requestAnimationFrame(step);
    }, [draw, stop]);
    useEffect(() => { stop(); gesture.current = null; stage.current?.classList.remove('is-pulling', 'is-dragging'); stage.current?.style.setProperty('--paper-pull', '0px'); position.current = props.current.index; reported.current = props.current.index; draw(); const ro = new ResizeObserver(draw); if (track.current)
        ro.observe(track.current); return () => { ro.disconnect(); stop(); }; }, [ids, draw, stop]);
    useEffect(() => { if (index !== reported.current) {
        reported.current = index;
        settle(index);
    } }, [index, settle]);
    useEffect(() => { if (disabled) {
        stop();
        gesture.current = null;
        position.current = props.current.index;
        draw();
        stage.current?.style.setProperty('--paper-pull', '0px');
        stage.current?.classList.remove('is-pulling', 'is-dragging');
    } }, [disabled, stop, draw]);
    useEffect(() => { const node = track.current; if (!node)
        return; const wheel = (event: WheelEvent) => { if (props.current.disabled || props.current.photos.length < 2)
        return; event.preventDefault(); if (gesture.current)
        return; stop(); const amount = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 250 : 1); position.current += clamp(amount / width.current * .65, -1.1, 1.1); draw(); wheelTimer.current = setTimeout(() => { if (!gesture.current && !props.current.disabled)
        settle(Math.round(position.current)); }, 130); }; node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel); }, [draw, settle, stop]);
    function down(event: React.PointerEvent<HTMLElement>, kind: 'reel' | 'pull') {
        if (event.button !== 0 || props.current.disabled || gesture.current || kind === 'reel' && props.current.photos.length < 2)
            return;
        event.stopPropagation();
        stop();
        suppress.current = false;
        if (kind === 'pull') {
            position.current = Math.round(position.current);
            draw();
        }
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position.current, lastX: event.clientX, time: performance.now(), velocity: 0, kind, moved: false, amount: 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
        stage.current?.classList.add(kind === 'pull' ? 'is-pulling' : 'is-dragging');
    }
    function move(event: React.PointerEvent<HTMLElement>) { const g = gesture.current; if (!g || g.id !== event.pointerId)
        return; const dx = event.clientX - g.x, dy = event.clientY - g.y; g.moved ||= Math.hypot(dx, dy) > 5; if (g.kind === 'pull') {
        g.amount = clamp(dy, 0, 170);
        stage.current?.style.setProperty('--paper-pull', g.amount * .6 + 'px');
    }
    else {
        const now = performance.now(), dt = Math.max(8, now - g.time);
        g.velocity = g.velocity * .35 + (g.lastX - event.clientX) / width.current / dt * .65;
        g.lastX = event.clientX;
        g.time = now;
        position.current = g.start - dx / width.current;
        draw();
    } }
    function end(event: React.PointerEvent<HTMLElement>, cancelled = false) { const g = gesture.current; if (!g || g.id !== event.pointerId)
        return; gesture.current = null; suppress.current = g.moved; try {
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
    catch { } stage.current?.classList.remove('is-pulling', 'is-dragging'); if (g.kind === 'pull') {
        stage.current?.style.setProperty('--paper-pull', '0px');
        if (!cancelled && g.amount >= 105 && !props.current.disabled)
            props.current.onStart();
    }
    else
        settle(reelDestination(position.current, cancelled || performance.now() - g.time > 100 ? 0 : g.velocity)); }
    return <div ref={stage} className={'paper-reel' + (disabled ? ' is-busy' : '')} role="region" aria-label={t("纸胶片选图，左右拖动或使用滚轮切换")} tabIndex={0} onKeyDown={event => { if (event.target !== event.currentTarget || disabled || photos.length < 2)
        return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        settle(Math.round(position.current) + (event.key === 'ArrowLeft' ? -1 : 1));
    } }}>
  <div className="paper-reel-shadow"/><div className="paper-reel-track" ref={track} onPointerDown={event => down(event, 'reel')} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}>{t(Array.from({ length: 7 }, (_, i) => <div key={i} ref={node => { frames.current[i] = node; }} className="paper-reel-card" style={{ transform: 'translate(-50%,-50%)', opacity: i === 3 ? 1 : 0 }} aria-hidden="true"><div className="paper-reel-paper"><img src={photos[wrapPhoto(index + i - 3, photos.length)]?.src} alt="" draggable={false}/></div></div>))}</div>
  <button className="paper-reel-tab" disabled={disabled} aria-label={t(pullLabel + '，向下拉或点击')} onPointerDown={event => down(event, 'pull')} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)} onClick={event => { if (event.detail === 0 || !suppress.current)
        onStart(); }}><span aria-hidden="true">↓</span>{t(pullLabel)}</button>
 </div>;
}
