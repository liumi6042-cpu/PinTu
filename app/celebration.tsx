'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PartyPopper, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CelebrationRenderer } from '@/lib/celebration-renderer';
import type { CelebrationBounds } from '@/lib/celebration-engine';
export function CelebrationOverlay({ getBoard, onFinish }: {
    getBoard: () => CelebrationBounds | null;
    onFinish: () => void;
}) {
    useLanguage();
    const canvas = useRef<HTMLCanvasElement>(null);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    useEffect(() => {
        if (!mounted || !canvas.current)
            return;
        // The result dialog must remain reachable even if canvas is unavailable.
        if (!canvas.current.getContext('2d')) {
            onFinish();
            return;
        }
        const renderer = new CelebrationRenderer(canvas.current, getBoard, onFinish);
        return () => renderer.destroy();
    }, [mounted, getBoard, onFinish]);
    return mounted ? createPortal(<canvas ref={canvas} className="celebration-canvas" aria-hidden="true"/>, document.body) : null;
}
export function CelebrationPreview({ photo, open, onOpenChange, aspectRatio = 4 / 3 }: {
    photo: {
        src: string;
        title: string;
    };
    open: boolean;
    onOpenChange: (open: boolean) => void;
    aspectRatio?: number;
}) {
    useLanguage();
    const picture = useRef<HTMLImageElement>(null), [playing, setPlaying] = useState(false);
    const getBoard = useCallback(() => { const r = picture.current?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; }, []);
    const finish = useCallback(() => setPlaying(false), []);
    useEffect(() => { setPlaying(open); }, [open]);
    return <><Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="celebration-preview"><DialogTitle><PartyPopper size={21}/>{t("拼块盛典")}</DialogTitle><DialogDescription>{t("彩纸跃出画面，庆祝浮在眼前。")}</DialogDescription><img className="celebration-preview-picture" style={{ aspectRatio }} ref={picture} src={photo.src} alt={t(`${photo.title}完成效果预览`)}/><p className="celebration-caption">{t("每一片，都刚刚好。")}</p><button className="primary" onClick={() => setPlaying(true)} disabled={playing}><RotateCcw size={17}/>{t(playing ? '庆祝中…' : '再庆祝一次')}</button><p className="room-footnote">{t("完成任意拼图后会自动播放 \u00B7 预览不改变拼图进度")}</p></DialogContent></Dialog>{t(open && playing && <CelebrationOverlay getBoard={getBoard} onFinish={finish}/>)}</>;
}
