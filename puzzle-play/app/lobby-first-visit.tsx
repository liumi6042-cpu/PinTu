'use client';
import { useEffect, useState } from 'react';

const FIRST_VISIT_KEY = 'jigsaw:lobby-first-visit:v1';

export default function LobbyFirstVisit({ zh, onEnterRooms }: { zh: boolean; onEnterRooms: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(FIRST_VISIT_KEY) !== '1') setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);
  if (!open) return null;
  const close = () => {
    try { localStorage.setItem(FIRST_VISIT_KEY, '1'); } catch {}
    setOpen(false);
  };
  return <div className="lobby-first-visit-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="lobby-first-visit" role="dialog" aria-modal="true" aria-labelledby="lobby-first-visit-title">
      <button className="lobby-first-visit-close" onClick={close} aria-label={zh ? '关闭引导' : 'Close guide'}>×</button>
      <span className="lobby-first-visit-kicker">JIGSAW NOOK</span>
      <h2 id="lobby-first-visit-title">{zh ? '今天想怎么拼？' : 'How would you like to puzzle today?'}</h2>
      <p>{zh ? '可以先挑一张喜欢的画面，也可以加入正在进行的房间。' : 'Choose a picture for yourself, or join a table that is already in progress.'}</p>
      <div className="lobby-first-visit-actions">
        <button className="secondary" onClick={close}>{zh ? '先看看大厅' : 'Browse the lobby'}</button>
        <button className="primary" onClick={() => { close(); onEnterRooms(); }}>{zh ? '直接进入已有房间' : 'Join an existing room'}</button>
      </div>
    </section>
  </div>;
}
