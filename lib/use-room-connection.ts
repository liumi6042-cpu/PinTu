'use client';
import { useEffect, useState } from 'react';
import { isLocalHostname } from './room-invite';

export function useRoomConnection() {
  const [connection, setConnection] = useState({ local: false, inviteOrigin: '', ready: false });
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/connection', { cache: 'no-store', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<{ mode: string; inviteOrigin?: string | null }>; })
      .then(data => setConnection({ local: data.mode === 'local', inviteOrigin: data.inviteOrigin || window.location.origin, ready: true }))
      .catch(() => { if (!controller.signal.aborted) setConnection({ local: isLocalHostname(window.location.hostname), inviteOrigin: window.location.origin, ready: true }); });
    return () => controller.abort();
  }, []);
  return connection;
}
