import type {ReactNode} from 'react';

// Small frame ornaments and currency marks use the same integer pixel grid as the B2 borders.
const starPath='M11 1h2v2h1v3h1v2h6v1h2v2h-2v2h-2v2h-2v3h1v4h-3v-1h-2v-1h-2v1H9v1H6v-4h1v-3H5v-2H3v-2H1V9h2V8h6V6h1V3h1z';
export const pixelDetails={
 frameLeaf:<><path d="M13 1h7v7h-2v3h-3v3h-3v4h-2v5H7v-7H4v-2H1V7h6v2h3v3h2V7h1z" fill="#72533e"/><path d="M15 3h4v4h-2v3h-3v2h-1V7h2z" fill="#a6a365"/><path d="M15 3h4v2h-3v3h-2V6h1z" fill="#e0d49a"/><path d="M3 9h3v2h3v4H5v-2H3z" fill="#9b985f"/><path d="M3 9h3v2h2v1H4v-1H3z" fill="#dace8e"/><path d="M11 14h2v3h-3v4H8v-5h2z" fill="#c0a165"/><path d="M7 17h2v3H7z" fill="#e9d49a"/></>,
 coin:<><path d="M8 0h8v2h4v3h2v3h2v8h-2v4h-3v2h-3v2H8v-2H4v-3H2v-3H0V8h2V4h3V2h3z" fill="#784330"/><path d="M8 2h8v2h4v4h2v8h-2v3h-4v3H8v-2H4v-4H2V8h2V5h4z" fill="#dca052"/><path d="M8 3h8v2H8v2H6v3H4v5H3V8h2V5h3z" fill="#fff0b9"/><path d="M9 5h7v2h3v9h-2v3H8v-2H5V9h2V7h2z" fill="#f4c572"/><path d="M18 8h2v8h-2v3h-3v2H8v-2h8v-3h2z" fill="#bd803f"/><path d="M10 8h4v3h3v4h-3v3h-4v-3H7v-4h3z" fill="#fff0c0"/><path d="M15 3h2v2h-2zM3 15h2v3H3z" fill="#f4db91"/></>,
 fragment:<><path d="M9 1h5v2h2v5h5v5h-3v4h3v6h-6v-3h-4v3H4v-6H1v-5h3V8h5V6H7V3h2z" fill="#9e5264"/><path d="M10 2h3v2h2v4h-2v2h6v2h-2v6h2v3h-3v-2h-6v2H6v-6H3v-2h3v-3h5V5H9V4h1z" fill="#cb8792"/><path d="M10 2h3v2h-3zM6 10h5v2H6zM3 13h3v2H3z" fill="#ebadb1"/><path d="M7 20h3v2H7zM16 19h3v3h-3z" fill="#ae6575"/></>,
 book:<><path d="M3 4h6l3 2 3-2h6v2h2v16H13v1h-2v-1H1V6h2z" fill="#693c3a"/><path d="M3 6h6l3 2 3-2h6v14h-7l-2 1-2-1H3z" fill="#f4daba"/><path d="M4 5h5l2 2v11l-2-1H4zM13 7l2-2h5v12h-5l-2 1z" fill="#fff3d9"/><path d="M4 8h4v1H4zM4 11h5v1H4zM4 14h4v1H4zM15 9h4v1h-4zM15 12h4v1h-4zM15 15h3v1h-3z" fill="#c89779"/><path d="M11 8h2v13h-2zM2 19h8v2H2zM14 19h8v2h-8z" fill="#ba7876"/><path d="M18 1h5v5h-2v3h-3V7h-3V4h3z" fill="#6e5a3c"/><path d="M19 2h3v3h-2v2h-3V5h2z" fill="#b6ab71"/><path d="M19 2h3v1h-2v2h-1z" fill="#e5d594"/></>,
 star:<><path d={starPath} fill="color-mix(in srgb, var(--decoration-color, #bc7987) 62%, #4e2530)"/><path d={starPath} transform="translate(1.5 1.5) scale(.875)" fill="var(--decoration-color, #d7ad68)"/><path d="M11 4h2v4h1v2h5v1h-6V9h-2zM5 10h4v2H5z" fill="#fff1c3" opacity=".72"/><path d="M8 17h2v2H8zM15 17h2v3h-2z" fill="#8d4d59" opacity=".25"/></>,
} satisfies Record<string,ReactNode>;

