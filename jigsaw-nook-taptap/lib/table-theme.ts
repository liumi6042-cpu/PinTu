export type TableTheme = 'beige' | 'dark';
export const TABLE_THEME_KEY = 'together-puzzle:table-background:v1';
export const parseTableTheme = (value: string | null): TableTheme => value === 'dark' ? 'dark' : 'beige';

export const TABLE_PALETTES = {
  beige: { board: '#cabc9f', border: '#94836d', grid: '#94836d44', hint: '#756754b0', caption: '#756754', owner: '#453e34' },
  dark: { board: '#303338', border: '#75777c', grid: '#9a9ca033', hint: '#c8bfb1cf', caption: '#c8bfb1', owner: '#f2e8d8' },
} satisfies Record<TableTheme, Record<string, string>>;
