'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useState } from 'react';
import { Puzzle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Game } from './puzzle-app';
import { customPhoto } from '@/lib/custom-images';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { RoomClient } from '@/lib/room-client';
import { joinPuzzle } from '@/lib/community-client';
import LanguageSwitch from './language-switch';
import { accountLoginUrl, SOLO_LOGIN_REQUIRED } from '@/lib/account-return';
const noop = () => { };
export default function RoomPlay({ roomId }: {
    roomId: string;
}) {
    useLanguage();
    const [client, setClient] = useState<RoomClient | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
    useEffect(() => { let canceled = false; setError(''); void joinPuzzle(roomId).then(ticket => { if (!canceled)
        setClient(new RoomClient(ticket)); }).catch(error => { if (!canceled)
        { if(error instanceof Error && error.message===SOLO_LOGIN_REQUIRED) { window.location.replace(accountLoginUrl('/room/'+roomId)); return; } setError(error instanceof Error ? error.message : '暂时无法加入房间'); } }); return () => { canceled = true; }; }, [roomId, attempt]);
    if (client) {
        const photo = client.snapshot.customImage?customPhoto(client.snapshot.customImage,client.snapshot.id):RESTORABLE_PHOTOS.find(p => p.id === client.state.imageId);
        if (photo)
            return <Game state={client.state} photo={photo} persist={noop} leave={() => { client.leave(); window.location.assign(client.snapshot.visibility === 'public' ? '/lobby' : '/personal'); }} restart={noop} saveError={false} collaboration={client}/>;
    }
    return <main className="room-join-page"><div className="room-join-heading"><a href="/lobby" className="back-button"><ArrowLeft size={18}/>{t("返回大厅")}</a><LanguageSwitch/></div><section className="join-card"><Puzzle size={38} className={error ? '' : 'loading-icon'}/><h1>{t(error ? '还没能入座' : '正在为你留一个位置…')}</h1>{t(error ? <><p role="alert" className="form-error">{t(error)}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={18}/>{t("重新连接")}</button></> : <p className="muted">{t("正在连接这张拼图桌面")}</p>)}</section></main>;
}
