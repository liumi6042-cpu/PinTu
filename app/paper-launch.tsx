'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { Puzzle } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PHOTOS } from '@/lib/puzzle-catalog';
export type PaperLaunchState = {
    photo: typeof PHOTOS[number];
    pieces: number;
    aspectRatio: number;
    phase: 'extracting' | 'starting';
};
export default function PaperLaunch({ launch }: {
    launch: PaperLaunchState;
}) {
    useLanguage();
    return <div className={'paper-launch launch-' + launch.phase} role="status" aria-live="polite" aria-label={t("正在准备拼图")}><div className="paper-launch-art"><img src={launch.photo.src} alt="" style={{ aspectRatio: launch.aspectRatio }}/><span>{t(launch.photo.title)}</span></div><div className="paper-launch-pieces" aria-hidden="true">{t(Array.from({ length: 12 }, (_, i) => <Puzzle key={i} size={22 + i % 4 * 9} style={{ '--piece-x': `${(i % 4 - 1.5) * 95}px`, '--piece-y': `${45 + Math.floor(i / 4) * 48}px`, '--piece-turn': `${i * 47 % 80 - 40}deg`, '--piece-delay': `${i * 18}ms` } as CSSProperties}/>))}</div><p>{t(launch.phase === 'extracting' ? '把喜欢的画，轻轻抽出来。' : `正在铺开 ${launch.pieces.toLocaleString()} 片拼图…`)}</p></div>;
}
