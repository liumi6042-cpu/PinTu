'use client';
import { t } from '@/lib/i18n';
import { useLanguage } from '@/app/language-switch';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { createMobileRoom, joinMobileRoom } from '../h5/mobile-api';
import { currentSearch } from '../h5/navigation';
import { accountLoginUrl, SOLO_LOGIN_REQUIRED } from '@/lib/account-return';
const noop = () => { };
export default function RoomPlay({ roomId, mobile = false, mobileStatus, onSupplies }: {
    roomId: string; mobile?: boolean; mobileStatus?: ReactNode; onSupplies?: () => void;
}) {
    const language = useLanguage();
    const [client, setClient] = useState<RoomClient | null>(null), [error, setError] = useState(''), [missing, setMissing] = useState(false), [countdown, setCountdown] = useState(5), [attempt, setAttempt] = useState(0);
    const admission=useRef<{roomId:string;attempt:number;promise:Promise<RoomTicket>}|null>(null);
    useEffect(() => { let canceled = false; setError('');
      setMissing(false);setCountdown(5);
      if(!admission.current||admission.current.roomId!==roomId||admission.current.attempt!==attempt)admission.current={roomId,attempt,promise:mobile ? joinMobileRoom(roomId,new URLSearchParams(currentSearch()).get('inviteCode') ?? new URLSearchParams(currentSearch()).get('invite') ?? undefined) : joinPuzzle(roomId)};
      void admission.current.promise.then(ticket => { if (!canceled)
        setClient(new RoomClient(ticket)); }).catch(error => { if (!canceled)
        { if(error instanceof Error && error.message === SOLO_LOGIN_REQUIRED) { window.location.replace(accountLoginUrl('/room/'+roomId)); return; } const status=(error as {status?:number})?.status; if(status===404||(status===410&&error instanceof Error&&error.message.includes('房间已过期'))){setMissing(true);return;} setError(error instanceof Error ? error.message : '暂时无法加入房间'); } }); return () => { canceled = true; }; }, [roomId, attempt, mobile]);
    const lobbyHref = language === 'zh' ? '/zh/lobby' : '/lobby';
    useEffect(() => { if(!missing)return; const started=Date.now(),timer=window.setInterval(()=>{const left=5-Math.floor((Date.now()-started)/1000);if(left<=0){window.clearInterval(timer);window.location.assign(lobbyHref);}else setCountdown(left);},200); return () => window.clearInterval(timer); }, [missing,lobbyHref]);
    if (client) {
        const photo = client.snapshot.customImage?customPhoto(client.snapshot.customImage,client.snapshot.id):RESTORABLE_PHOTOS.find(p => p.id === client.state.imageId);
        // Another table, straight away: a different picture at the same size, so a finished
        // puzzle is followed by playing rather than by choosing.
        const startNextTable = async () => {
            if (mobile) {
                const current = (client.snapshot as typeof client.snapshot & {requestedPieces?:number}).requestedPieces ?? client.state.cols * client.state.rows;
                const pieces = ([48,108,300,500].includes(current) ? current : 108) as 48 | 108 | 300 | 500;
                const ticket = await createMobileRoom({mode:'random',pieces,visibility:'public'});
                saveTicket(ticket); client.leave(); window.location.assign('/room/' + ticket.room.id); return;
            }
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
            return <Game state={client.state} photo={photo} persist={noop} leave={() => { client.leave(); window.location.assign(mobile ? '/zh/lobby' : client.snapshot.visibility === 'public' ? '/lobby' : '/personal'); }} restart={noop} saveError={false} collaboration={client} onNext={mobile || client.snapshot.visibility === 'public' ? startNextTable : undefined} mobile={mobile} mobileStatus={mobileStatus} onSupplies={onSupplies}/>;
    }
    return <main className="room-join-page"><div className="room-join-heading"><a href={lobbyHref} className="back-button"><ArrowLeft size={18}/>{t("返回大厅")}</a>{!mobile && <LanguageSwitch/>}</div><section className={'join-card'+(missing?' room-missing-card':'')}><Puzzle size={38} className={error||missing ? '' : 'loading-icon'}/><h1>{t(missing ? '此房间已经不存在' : error ? '还没能入座' : '正在为你留一个位置…')}</h1>{missing?<><p role="alert" className="form-error">{t("这个链接对应的房间已结束或已被清理。")}</p><p className="room-missing-countdown">{t("%s 秒后自动进入公开大厅").replace('%s',String(countdown))}</p><button className="primary" onClick={()=>window.location.assign(lobbyHref)}>{t("立即进入公开大厅")}</button></>:t(error ? <><p role="alert" className="form-error">{t(error)}</p><button className="primary" onClick={() => setAttempt(n => n + 1)}><RefreshCw size={18}/>{t("重新连接")}</button></> : <p className="muted">{t("正在连接这张拼图桌面")}</p>)}</section></main>;
}
