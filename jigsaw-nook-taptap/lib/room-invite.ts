export function isLocalHostname(hostname: string) {
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return true;
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function roomInviteTarget(value: string, currentOrigin: string, local: boolean) {
  const input = value.trim();
  const target = /^[a-f0-9]{32}$/.test(input)
    ? new URL(`/room/${input}`, currentOrigin) : new URL(input, currentOrigin);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
    !/^\/room\/[a-f0-9]{32}\/?$/.test(target.pathname)) throw new Error('请粘贴完整的房间邀请链接');
  if (local && !isLocalHostname(target.hostname)) throw new Error('本地模式请使用同一局域网内的房间邀请链接');
  return `${target.origin}${target.pathname.replace(/\/$/, '')}`;
}
