import type { ReactNode } from 'react';

export type MobileVectorIconKind = 'lightning' | 'store' | 'piece' | 'players' | 'help' | 'edge' | 'fit' | 'hint' | 'underlay' | 'tools' | 'shuffle' | 'create';

// Smooth vector contours retain the warm outline and restrained cream/sage
// colours of the approved illustrated concept, without atlas edge artefacts.
const shapes: Record<MobileVectorIconKind, ReactNode> = {
  lightning: <>
    <path d="M13 2.8h11.1L18.2 14H26L10.4 29.2l3.1-12.1H6L13 2.8Z" fill="var(--art-sage)" />
    <path d="m14.2 5-5 9.9h2.6L16.2 5Z" fill="var(--art-cream)" opacity=".88" stroke="none" />
    <path d="m18.9 16.5-4.7 6.7 7-6.7Z" fill="var(--art-sage-shadow)" opacity=".7" stroke="none" />
  </>,
  store: <>
    <path d="M6.7 13.5v14.4h18.6V13.5M5.4 28h21.2" strokeWidth="2.1" />
    <path d="M13 28V18h6v10" strokeWidth="1.8" />
    <path d="M4 10.7 7.2 4.8h17.6l3.2 5.9" strokeWidth="1.8" />
    <path d="m7.2 4.8-3.2 5.9h6l1.3-5.9Zm8.8 0v5.9h6l-1.3-5.9Z" fill="var(--art-brown)" stroke="none" />
    <path d="M4 10.7h6v2a3 3 0 0 1-6 0Zm6 0h6v2a3 3 0 0 1-6 0Zm6 0h6v2a3 3 0 0 1-6 0Zm6 0h6v2a3 3 0 0 1-6 0Z" strokeWidth="1.6" />
    <path d="M4 10.7h6v2a3 3 0 0 1-6 0Zm12 0h6v2a3 3 0 0 1-6 0Z" fill="var(--art-brown)" stroke="none" />
    <rect x="6.4" y="2.6" width="19.2" height="2.7" rx="1" fill="var(--art-brown)" stroke="none" />
  </>,
  piece: <>
    <path d="M5 8.8h7.1c.4 0 .7-.5.5-.9a4.5 4.5 0 1 1 8 0c-.2.4.1.9.5.9H27v4c0 .6-.5.9-1 .6a4.3 4.3 0 1 0 0 7.5c.5-.3 1 0 1 .6V28H5v-7.1c0-.5.5-.8.9-.6a4.3 4.3 0 1 0 0-7.5c-.4.2-.9-.1-.9-.6Z" fill="var(--art-cream)" />
    <path d="M7.3 11.2h4.1M7.3 23.4v2.2h15.9" fill="none" stroke="var(--art-paper)" strokeWidth="1.5" />
  </>,
  players: <>
    <path d="M23.1 6.1a4.5 4.5 0 0 1 1.8 8.6c3.5 1 5.2 4 5.2 9.3v2H19.3V15a4.5 4.5 0 0 1 3.8-8.9Z" fill="var(--art-wood)" />
    <path d="M12 3.2a6.1 6.1 0 0 1 2.6 11.6c5.5 1.5 8 5.5 8 12.8H1.4c0-7.3 2.5-11.3 8-12.8A6.1 6.1 0 0 1 12 3.2Z" fill="var(--art-sand)" />
    <path d="M5.5 22.1c.6-2 1.8-3.5 3.9-4.2M8.7 6.7a4 4 0 0 1 3.4-1.2" fill="none" stroke="var(--art-paper)" strokeWidth="1.3" />
  </>,
  help: <>
    <circle cx="16" cy="16" r="13.5" fill="var(--art-cream)" />
    <path d="M11.5 11.8c.1-6.1 10.2-5.8 10.2.1 0 3.3-5.3 3.8-5.3 7.6" fill="none" strokeWidth="3" />
    <circle cx="16.3" cy="24" r="1.4" fill="var(--art-brown)" stroke="none" />
  </>,
  edge: <>
    <path d="M11 4H5a1 1 0 0 0-1 1v6m17-7h6a1 1 0 0 1 1 1v6M4 21v6a1 1 0 0 0 1 1h6m17-7v6a1 1 0 0 1-1 1h-6M15 4h2M4 15v2m24-2v2m-13 11h2" fill="none" strokeWidth="2.7" />
  </>,
  fit: <>
    <path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7M4.4 4.4 12 12m15.6-7.6L20 12m7.6 15.6L20 20m-15.6 7.6L12 20" fill="none" strokeWidth="2.6" />
  </>,
  hint: <>
    <path d="M10.9 22.4c0-4.1-4.7-5.7-4.7-11a9.8 9.8 0 0 1 19.6 0c0 5.3-4.7 6.9-4.7 11Z" fill="var(--art-cream)" transform="translate(3 4) scale(.8125)" strokeWidth="2.3" />
    <path d="M11.9 22.5h8.2v3.2h-8.2Zm1.1 3.2h6c-.3 2.3-1.3 3.4-3 3.4s-2.7-1.1-3-3.4Z" fill="var(--art-sand)" />
    <path d="M16 1.4v2.8M4.2 5.9l1.9 2.2m21.7-2.2-1.9 2.2M10.8 12c.3-1.5 1.1-2.5 2.6-3.1" fill="none" strokeWidth="2" />
  </>,
  underlay: <>
    <rect x="2.6" y="5.1" width="26.8" height="23.3" rx="3.2" fill="var(--art-cream)" />
    <circle cx="10.1" cy="12" r="3.1" fill="var(--art-sage)" stroke="none" />
    <path d="m4.9 23.9 6.3-7 3.5 3.9 6.3-8 6.2 9v3.6H4.9Z" fill="var(--art-sage)" stroke="none" />
    <path d="m15.4 20.5 5.6-7.1 6.2 9v3h-1.8Z" fill="var(--art-sage-shadow)" opacity=".65" stroke="none" />
  </>,
  tools: <>
    <circle cx="5" cy="16" r="3" fill="var(--art-brown)" stroke="none" />
    <circle cx="16" cy="16" r="3" fill="var(--art-brown)" stroke="none" />
    <circle cx="27" cy="16" r="3" fill="var(--art-brown)" stroke="none" />
  </>,
  shuffle: <>
    <path d="M3.6 8.4c11.7 0 10.4 15.2 22.8 15.2M3.6 23.6c11.7 0 10.4-15.2 22.8-15.2M22.6 4.6l4.7 3.8-4.7 3.8m0 7.6 4.7 3.8-4.7 3.8" fill="none" strokeWidth="3" />
  </>,
  create: <>
    <circle cx="16" cy="16" r="13" fill="none" strokeWidth="2.4" />
    <path d="M16 9v14M9 16h14" fill="none" strokeWidth="2.8" />
  </>,
};

export function MobileVectorIcon({ kind }: { kind: MobileVectorIconKind }) {
  return <svg className="mobile-art-svg mobile-art-vector" viewBox="0 0 32 32" fill="none" stroke="var(--art-brown)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">{shapes[kind]}</svg>;
}
