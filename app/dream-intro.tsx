'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';
import { usePathname } from 'next/navigation';
import { isChinesePath } from '@/lib/site-paths';
import { markLobbyVisited } from '@/lib/entrance-preference';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Hand } from 'lucide-react';
import { PAPER_PIECE_PATH, reducedPaperMotion } from '@/lib/paper-interactions';
import HomeNavigation from './home-navigation';
export default function DreamIntro({ onEnter, dailyTitle }: {
    onEnter: () => void;
    dailyTitle?: string;
}) {
    useLanguage();
    // The link down to the cards below names today's picture, which the server picked
    // in the page's own language. Its label follows the address for the same reason:
    // t() is the interface language and on the server it is English, which put an
    // English label next to a Chinese picture name in the Chinese page's HTML.
    const zhPage = isChinesePath(usePathname() || '');
    const scene = useRef<HTMLElement>(null);
    const stage = useRef<HTMLDivElement>(null);
    const key = useRef<HTMLButtonElement>(null);
    const slot = useRef<HTMLDivElement>(null);
    const phaseRef = useRef('idle');
    const done = useRef(false);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const raf = useRef(0);
    const suppress = useRef(false);
    const drag = useRef<{
        id: number;
        x: number;
        y: number;
        moved: boolean;
    } | null>(null);
    const [phase, setPhase] = useState('idle');
    const [near, setNear] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => () => {
        for (const timer of timers.current)
            clearTimeout(timer);
        cancelAnimationFrame(raf.current);
    }, []);
    function finish() {
        if (done.current)
            return;
        done.current = true;
        for (const timer of timers.current)
            clearTimeout(timer);
        cancelAnimationFrame(raf.current);
        // The entrance has now been seen; from the next visit this browser goes
        // straight to the tables.
        markLobbyVisited();
        onEnter();
    }
    function enter(fromPiece = false) {
        if (phaseRef.current !== 'idle' || done.current)
            return;
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
        if (reducedPaperMotion()) {
            finish();
            return;
        }
        if (fromPiece)
            timers.current.push(setTimeout(() => {
                phaseRef.current = 'opening';
                setPhase('opening');
            }, 240));
        timers.current.push(setTimeout(finish, fromPiece ? 1560 : 1320));
    }
    function release(event: React.PointerEvent<HTMLButtonElement>, cancelled = false) {
        const gesture = drag.current;
        if (!gesture || event.pointerId !== gesture.id)
            return;
        drag.current = null;
        suppress.current = gesture.moved;
        setDragging(false);
        event.currentTarget.classList.remove('is-dragging');
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        catch { }
        const piece = event.currentTarget.getBoundingClientRect();
        const target = slot.current?.getBoundingClientRect();
        if (!cancelled && gesture.moved && target && Math.hypot(piece.left + piece.width / 2 - target.left - target.width / 2, piece.top + piece.height / 2 - target.top - target.height / 2) < Math.max(86, target.width * .72))
            enter(true);
        else {
            event.currentTarget.style.transform = '';
            setNear(false);
            if (gesture.moved)
                setMessage('把拼块拖到画中的缺口，或点击「进入大厅」。');
        }
    }
    return <main ref={scene} className={`paper-entrance entrance-${phase}${dragging ? ' entrance-dragging' : ''}`} onPointerMove={event => {
            if (drag.current || phaseRef.current !== 'idle' || event.pointerType !== 'mouse' || reducedPaperMotion())
                return;
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
      <a className="entrance-brand" href="/">{t("一起拼图")}</a>
      <HomeNavigation />
    </header>

    <section className="entrance-copy">
      <h1>{t("把时光，")}<br />{t("拼成喜欢的样子。")}</h1>
      <p className="entrance-subtitle">{t("从一片开始，收集生活里的美好")}</p>
      <button className="entrance-enter" onClick={() => enter()} disabled={phase !== 'idle'}>
        {t(phase === 'idle' ? '进入大厅' : '正在进入…')}<ArrowRight size={22} strokeWidth={1.3}/>
      </button>
      <p className="entrance-note">{t("无需登录，即刻开始")}</p>
      <p className="entrance-play-note"><Hand size={17} strokeWidth={1.6}/>{t("也可以拖动下方拼块，亲手开启")}</p>
      {dailyTitle && <p className="entrance-daily"><a href="#today">{zhPage ? '今天的图' : 'Picture of the day'} · {dailyTitle}<span aria-hidden="true"> ↓</span></a></p>}
    </section>

    <div className="entrance-stage" ref={stage}>
      <div className="entrance-camera" aria-hidden="true">
        <img className="entrance-scenery" src="/intro/hero-paper-coast-be03040892f1.webp" width={1672} height={941} alt="" fetchPriority="high" draggable={false}/>
      </div>
      <svg className="entrance-drag-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="entrance-guide-wide" d="M 21 79 C 38 85, 51 73, 62 57"/>
        <path className="entrance-guide-small" d="M 36 74 C 46 82, 53 71, 57 61"/>
      </svg>
      <div className={`entrance-slot${near ? ' is-near' : ''}`} ref={slot} aria-hidden="true">
        <svg viewBox="0 0 100 100"><path d={PAPER_PIECE_PATH}/></svg>
        <span className="entrance-slot-number">2</span>
        <span className="entrance-slot-label">{t(near ? '松手，开启拼图' : '把拼块放到这里')}</span>
      </div>
      <button className="entrance-piece" ref={key} aria-label={t("拖动这块拼图到海岸画中的缺口，或点击进入选图")} aria-describedby="entrance-drag-instruction" disabled={phase !== 'idle'} onClick={event => { if (event.detail === 0 || !suppress.current)
        enter(); }} onPointerDown={event => {
            if (event.button !== 0 || phaseRef.current !== 'idle' || drag.current)
                return;
            cancelAnimationFrame(raf.current);
            suppress.current = false;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.classList.add('is-dragging');
            setDragging(true);
            setMessage('拖向右上方标记 2 的缺口，靠近后松手。');
        }} onPointerMove={event => {
            const gesture = drag.current;
            if (!gesture || gesture.id !== event.pointerId)
                return;
            const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
            gesture.moved ||= Math.hypot(dx, dy) > 5;
            event.currentTarget.style.transform = `translate(${dx}px,${dy}px) rotate(-12deg)`;
            const piece = event.currentTarget.getBoundingClientRect(), target = slot.current?.getBoundingClientRect();
            if (target)
                setNear(Math.hypot(piece.left + piece.width / 2 - target.left - target.width / 2, piece.top + piece.height / 2 - target.top - target.height / 2) < Math.max(86, target.width * .72));
        }} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onLostPointerCapture={event => release(event, true)}>
        <svg className="entrance-piece-shape" viewBox="0 0 100 100" aria-hidden="true"><path d={PAPER_PIECE_PATH}/></svg>
        <span className="entrance-piece-grip" aria-hidden="true"><Hand size={34} strokeWidth={1.4}/><span>{t("拖动我")}</span></span>
        <span className="entrance-piece-number" aria-hidden="true">1</span>
      </button>
      <p className="entrance-piece-label" id="entrance-drag-instruction">{t("拿起这一片 ")}<ArrowRight size={17} strokeWidth={1.5}/><span>{t("拼进缺口，开启旅程")}</span></p>
    </div>

    <footer className="entrance-footer">
      <span role="status" aria-live="polite">{t(message)}</span>
      <button onClick={finish}>{t("跳过开场 \u2192")}</button>
    </footer>
    <div className="entrance-wash" aria-hidden="true"/>
  </main>;
}
