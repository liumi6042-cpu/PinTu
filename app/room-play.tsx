'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useRef, useState } from 'react';
import { Puzzle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Game } from './puzzle-app';
import { customPhoto } from '@/lib/custom-images';
import { RESTORABLE_PHOTOS } from '@/lib/puzzle-catalog';
import { DEFAULT_PIECES } from '@/lib/piece-policy';
import { nextTableChoice } from '@/lib/next-table';
import { RoomClient, saveTicket } from '@/lib/room-client';
import type { RoomTicket } from '@/lib/room-client';
import { apiJson, joinPuzzle } from '@/lib/community-client';
import LanguageSwitch from './language-switch';
import { accountLoginUrl, SOLO_LOGIN_REQUIRED } from '@/lib/account-return';
const noop = () => { };
export default function RoomPlay({ roomId }: {
    roomId: string;
}) {
    useLanguage();
    const [client, setClient] = useState<RoomClient | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
    const admission=useRef<{roomId:string;attempt:number;promise:Promise<RoomTicket>}|null>(null);
    useEffect(() => { let canceled = false; setError('');
      if(!admission.current||admission.current.roomId!==roomId||admission.current.attempt!==attempt)admission.current={roomId,attempt,promise:joinPuzzle(roomId)};
      void admission.current.promise.then(ticket => { if (!canceled)
        setClient(new RoomClient(ticket)); }).catch(error => { if (!canceled)
        { if(error instanceof Error && error.message === SOLO_LOGIN_REQUIRED) { window.location.replace(accountLoginUrl('/room/'+roomId)); return; } setError(error instanceof Error ? error.message : '暂时无法加入房间'); } }); return () => { canceled = true; }; }, [roomId, attempt]);
    if (client) {
        const photo = client.snapshot.customImage?customPhoto(client.snapshot.customImage,client.snapshot.id):RESTORABLE_PHOTOS.find(p => p.id === client.state.imageId);
        // Another table, straight away: a different picture at the same size, so a finished
        // puzzle is followed by playing rather than by choosing.
        const startNextTable = async () => {
            const { photo: next, pieces } = nextTableChoice({ imageId: client.state.imageId, cols: client.state.cols, rows: client.state.rows });
            const open = (imageId: string, count: number) => apiJson<RoomTicket>('/api/rooms', { imageId, pieces: count, visibility: 'public' });
            let ticket: RoomTicket;
            try { ticket = await open(next.id, pieces); }
            catch (error) {
                // A table of 500 pieces or more needs a free account to create. A guest who was
                // sitting in one can still keep playing, so they get the free size instead of a
                // button that never works.
                if (pieces === DEFAULT_PIECES) throw error;
                ticket = await open(next.id, DEFAULT_PIECES);
            }
            saveTicket(ticket);
            client.leave();
            window.location.assign('/room/' + ticket.room.id);
        };
        if (photo)
            return <Game state={client.state} photo={photo} persist={noop} leave={() => { client.leave(); window.location.assign(client.snapshot.visibility === 'public' ? '/lobby' : '/personal'); }} restart={noop} saveError={false} collaboration={client} onNext={client.snapshot.visibility === 'public' ? startNextTable : undefined}/>;
    }
    return <main className="room-join-page"><div className="room-join-heading"><a href="/lobby" className="back-button"><ArrowLeft size={18}/>{t("返回大厅")}</a><LanguageSwitch/></div><section className="join-card"><Puzzle size={38} className={error ? '' : 'loading-icon'}/><h1>{t(error ? '还没能入座' : '正在为你留一个位置…')}</h1>{t(error ? <><p role="alert" className="form-error">{t(error)}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={18}/>{t("重新连接")}</button></> : <p className="muted">{t("正在连接这张拼图桌面")}</p>)}</section></main>;
}
