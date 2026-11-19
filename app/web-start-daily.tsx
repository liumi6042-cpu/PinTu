'use client';

import { useState } from 'react';
import { guestCreationSecret } from '@/lib/guest-client';

type StartResponse = { room?: { id?: unknown }; error?: unknown };

export default function StartDaily({ zh }: { zh: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/shared/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Jigsaw-Artwork-Snapshot': '1' },
        body: JSON.stringify({ mode: 'daily', pieces: 108, guestSecret: await guestCreationSecret() }),
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json() as StartResponse | null;
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : '');
      const id = data?.room?.id;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error();
      window.location.assign('/play?room=' + id);
    } catch (cause) {
      const message = zh ? '暂时无法开桌，请稍后再试。' : 'Could not open the table. Please try again.';
      setError(zh && cause instanceof Error && /\p{Script=Han}/u.test(cause.message) ? cause.message : message);
    } finally {
      setPending(false);
    }
  }

  return <div className="web-home-action">
    <button type="button" className="web-home-start" disabled={pending} onClick={start}>
      {pending ? (zh ? '正在开桌…' : 'Opening table…') : (zh ? '开始拼图 · 108 片' : 'Start puzzle · 108 pieces')}
    </button>
    <small>{zh ? '打开公开拼图桌，无需注册' : 'Open a public table. No sign-up needed.'}</small>
    {error && <p role="alert">{error}</p>}
  </div>;
}
