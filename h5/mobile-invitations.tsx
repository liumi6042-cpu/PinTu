import { useEffect, useState } from 'react';
import { h5Config } from './config';
import { currentPath, currentSearch, navigate, useSearchParams } from './navigation';
import { MobileInvitationSheet } from './mobile-tasks';

function storageKey() { return 'jigsaw:pending-invitation:' + h5Config().apiBase; }
function validCode(value: string | null) {
  const code = (value || '').trim().toLowerCase();
  return /^[a-f0-9]{12}$/.test(code) ? code : '';
}
function savedCode() {
  try { return validCode(sessionStorage.getItem(storageKey())); } catch { return ''; }
}

/** Invite links ask for confirmation; opening a link never binds an account by itself. */
export function MobileInvitationBridge() {
  const params = useSearchParams();
  const ref = params.get('ref');
  const [pending, setPending] = useState(savedCode);
  useEffect(() => {
    const outer = new URL(window.location.href);
    const code = validCode(ref) || validCode(outer.searchParams.get('ref'));
    if (!code) return;
    setPending(code);
    try { sessionStorage.setItem(storageKey(), code); } catch {}
    // Remove attribution only; private room admission and the intended room remain intact.
    if (outer.searchParams.has('ref')) {
      outer.searchParams.delete('ref');
      history.replaceState(history.state, '', outer.href);
    }
    const query = new URLSearchParams(currentSearch());
    if (query.has('ref')) {
      query.delete('ref');
      navigate(currentPath() + (query.size ? '?' + query : ''), true);
    }
  }, [ref]);
  function close() {
    try { sessionStorage.removeItem(storageKey()); } catch {}
    setPending('');
  }
  return pending ? <MobileInvitationSheet key={pending} code={pending} onClose={close}/> : null;
}
