import {puzzlePiecePath} from './puzzle-piece-symbol';
// Shared SVG data: Canvas and React render precisely the same utility symbols.
export const mobileSymbolPaths={
 piece:[{d:puzzlePiecePath}],
 person:[{"d":"M9 2h6v1h2v2h1v5h-1v2h-2v2h2v1h3v2h1v6H3v-6h1v-2h3v-1h2v-2H7v-2H6V5h1V3h2z"}],
 players:[{"d":"M10 1h4v1h2v2h1v4h-1v2h-2v1h-4v-1H8V8H7V4h1V2h2zM8 12h8v1h2v2h1v8H5v-8h1v-2h2z"},{"d":"M2 5h3v1h1v5H5v1H2v-1H1V6h1zM1 14h4v1H4v2H3v5H0v-6h1zM19 5h3v1h1v5h-1v1h-3v-1h-1V6h1zM19 14h4v2h1v6h-3v-5h-1v-2h-1z"}],
 invite:[{"d":"M12 2h5v1h2v2h1v4h-1v2h-2v1h-5v-1h-2V9H9V5h1V3h2zM11 14h7v1h3v2h1v6H7v-6h1v-2h3z"},{"d":"M3 5h3v4h4v3H6v4H3v-4H0V9h3z"}],
 daily:[{"d":"M4 5h16v1h1v16H3V6h1zM7 12v3h2v2h2v-1h1v-1h1v-1h1v-1h1v-1h1V9h-2v1h-1v1h-1v1h-1v1H9v-1z","fillRule":"evenodd"},{"d":"M6 1h3v6H6zM15 1h3v6h-3z"}],
 filter:[{"d":"M2 3h20v4h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1h-1v9h-2v-1h-2v-1H9v-7H8v-1H7v-1H6v-1H5V9H4V8H3V7H2z"}],
 back:[{"d":"M10 2h3v4h-1v1h-1v1h-1v1h12v6H10v1h1v1h1v1h1v4h-3v-1H9v-1H8v-1H7v-1H6v-1H5v-1H4v-1H3v-1H2v-4h1V9h1V8h1V7h1V6h1V5h1V4h1V3h1z"}],
 create:[{"d":"M10 2h4v1h1v6h6v1h1v4h-1v1h-6v6h-1v1h-4v-1H9v-6H3v-1H2v-4h1V9h6V3h1z"}],
 tools:[{"d":"M3 2h6v1h1v7H2V3h1zM15 2h6v1h1v7h-8V3h1zM2 14h8v8H3v-1H2zM14 14h8v7h-1v1h-7z"}],
 video:[{"d":"M2 4h20v1h1v14h-1v1H2v-1H1V5h1zM3 6v3h2V6zM3 10v4h2v-4zM3 15v3h2v-3zM19 6v3h2V6zM19 10v4h2v-4zM19 15v3h2v-3zM9 7v10h2v-1h1v-1h2v-1h1v-1h2v-2h-2v-1h-1V9h-2V8h-1V7z","fillRule":"evenodd"}],
 bag:[{"d":"M7 3h10v1h1v3h3v1h1v13H2V8h1V7h3V4h1zM9 5v2h6V5z","fillRule":"evenodd"}],
 underlay:[{"d":"M4 3h16v1h1v1h1v16H2V5h1V4h1zM5 6v12h14V6z","fillRule":"evenodd"},{"d":"M15 8h2v2h-2zM5 16h1v-1h1v-1h1v-1h1v-1h2v1h1v1h1v1h2v-1h1v1h1v1h1v1h1v2H5z"}],
 edge:[{"d":"M3 2h6v3H5v4H2V3h1zM15 2h6v1h1v6h-3V5h-4zM2 15h3v4h4v3H3v-1H2zM19 15h3v6h-1v1h-6v-3h4z"}],
 fit:[{"d":"M2 2h8v3H7v1h1v1h1v1h1v1h1v2H9v-1H8V9H7V8H6V7H5v3H2zM14 2h8v8h-3V7h-1v1h-1v1h-1v1h-1v1h-2V9h1V8h1V7h1V6h1V5h-3zM2 14h3v3h1v-1h1v-1h1v-1h1v-1h2v2h-1v1H9v1H8v1H7v1h3v3H2zM19 14h3v8h-8v-3h3v-1h-1v-1h-1v-1h-1v-1h-1v-2h2v1h1v1h1v1h1v1h1z"}],
 dice:[{"d":"M11 1h2v1h2v1h2v1h2v1h2v1h1v12h-2v1h-2v1h-2v1h-2v1h-1v1h-2v-1H9v-1H7v-1H5v-1H3v-1H2V6h1V5h2V4h2V3h2V2h2zM11 4v1H9v1H7v1H5v1h2v1h2v1h2v1h2v-1h2V9h2V8h2V7h-2V6h-2V5h-2V4zM4 10v7h2v1h2v1h2v1h1v-7H9v-1H7v-1H5v-1zM20 10h-1v1h-2v1h-2v1h-2v7h1v-1h2v-1h2v-1h2z","fillRule":"evenodd"},{"d":"M11 6h2v2h-2zM5 12h2v2H5zM8 16h2v2H8zM17 12h2v2h-2zM14 16h2v2h-2z"}],
 lock:[{"d":"M9 1h6v1h2v2h1v5h3v14H3V9h3V4h1V2h2zM9 4v5h6V4zM11 12v2h-1v2h1v4h2v-4h1v-2h-1v-2z","fillRule":"evenodd"}],
 giftFlat:[{"d":"M2 9h20v6h-2v8H4v-8H2zM11 10v13h2V10z","fillRule":"evenodd"},{"d":"M5 1h4v1h1v1h1v2h2V3h1V2h1V1h4v1h2v2h1v3h-1v1h-2v1H5V8H3V7H2V4h1V2h2zM6 4v2h1v1h3V6H9V5H8V4zM16 4v1h-1v1h-1v1h3V6h1V4z","fillRule":"evenodd"}]
} as const;
