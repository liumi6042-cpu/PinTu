'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useRef, useState } from 'react';
import { Users, Copy, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { RoomClient } from '@/lib/room-client';
import { useRoomConnection } from '@/lib/use-room-connection';
export default function RoomToolbar({ client }: {
    client: RoomClient;
}) {
    useLanguage();
    const [, refresh] = useState(0), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false), connection = useRoomConnection();
    const invite = connection.inviteOrigin ? `${connection.inviteOrigin}/room/${client.snapshot.id}` : '';
    const inviteInput = useRef<HTMLInputElement>(null);
    useEffect(() => client.subscribe(() => refresh(n => n + 1)), [client]);
    async function copy() { try {
        await navigator.clipboard.writeText(invite);
        setCopied(true);
        setCopyError(false);
        setTimeout(() => setCopied(false), 2000);
    }
    catch {
        setCopyError(true);
        requestAnimationFrame(() => { inviteInput.current?.focus(); inviteInput.current?.select(); });
    } }
    return <section className="room-toolbar" aria-label={t("多人房间")}>
        <div className="room-members">
            <span className="room-count"><Users size={17}/>{t(client.snapshot.members.length)} / 8</span>
            {client.snapshot.acceptingNew === false && <span className="room-admission-note">{t("暂停接待新玩家")}</span>}
        </div>
        <div className="room-actions">
            <button className="text-button" onClick={copy} disabled={!connection.ready}>
                {copied ? <Check size={15}/> : <Copy size={15}/>}
                <span>{t(copied ? '已复制邀请' : '邀请朋友')}</span>
            </button>
        </div>
        {copyError && <label className="copy-fallback">
            {t('已选中链接，按 Ctrl+C 或长按复制')}
            <Input ref={inviteInput} readOnly value={invite} onFocus={e => e.target.select()}/>
        </label>}
        {(!client.connected || client.message !== '房间已连接') && <p className="room-error" role="status">{t(client.message)}</p>}
    </section>;
}
