import { h5Config } from './config';

/** Share the independently hosted mobile game; never the bundle CDN or PC route. */
export function mobileInviteUrl(code: string, room?: {id: string; inviteCode?: string}): string {
  const ref = code.trim().toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(ref)) throw new Error('邀请码暂未准备好，请重试');
  if (room && !/^[a-f0-9]{32}$/.test(room.id)) throw new Error('房间链接无效');
  const config = h5Config();
  const entry = new URL(config.gameBase || '/', new URL(config.apiBase).origin);
  entry.hash = ''; entry.search = '';
  const params = new URLSearchParams();
  if (room?.inviteCode) params.set('inviteCode', room.inviteCode);
  params.set('ref', ref);
  return entry.href + '#' + (room ? '/room/' + room.id : '/zh/lobby') + '?' + params;
}
