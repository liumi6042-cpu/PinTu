'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { LockKeyhole, Clapperboard } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ASSISTANCE_POLICY, type AssistanceKind } from '@/lib/assistance-policy';
export default function AssistanceDialog({ kind, onClose }: {
    kind: AssistanceKind | null;
    onClose: () => void;
}) {
    useLanguage();
    const policy = kind ? ASSISTANCE_POLICY[kind] : null;
    return <Dialog open={kind !== null} onOpenChange={open => { if (!open)
        onClose(); }}><DialogContent className="underlay-dialog"><div className="room-icon"><LockKeyhole size={26}/></div><DialogTitle>{t(`${policy?.title ?? ''}暂时锁定`)}</DialogTitle><DialogDescription>{t(policy?.description)}</DialogDescription><div className="ad-rule"><Clapperboard size={22}/><div><strong>{t(kind === 'hint' ? '每局最多 3 次' : kind === 'reference' ? '不限次数 · 每次 30 秒' : '每次 30 秒')}</strong><p>{t("广告解锁暂未开放")}</p></div></div><button className="primary" onClick={onClose}>{t("知道了，继续拼图")}</button></DialogContent></Dialog>;
}
