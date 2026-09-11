export const SOLO_LOGIN_REQUIRED = '个人拼图需要登录后才能游玩。';
const destinations = new Set(['/personal/images', '/membership/manage', '/gallery?mode=create', '/personal?mode=create', '/gallery?mode=solo', '/personal?mode=solo', '/account/security', '/admin']);

export function accountReturnTo(value: string | null): string | null {
  if (!value) return null;
  if (destinations.has(value) || /^\/room\/[a-f0-9]{32}$/.test(value)) return value;
  // Restore one known-format device save, never an arbitrary URL or extra query.
  if (!value.startsWith('/gallery?')) return null;
  const query = new URLSearchParams(value.slice('/gallery?'.length));
  const key = query.get('resume');
  if ([...query].length !== 1 || !key || !/^together-puzzle:v1:[a-z0-9-]+:\d{1,5}$/.test(key)) return null;
  return '/gallery?' + new URLSearchParams({ resume: key });
}
export function accountLoginUrl(destination: string) {
  return '/account?' + new URLSearchParams({ returnTo: accountReturnTo(destination) || '/personal?mode=solo' });
}
