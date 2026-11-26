import { WORLD } from './puzzle-engine';

export const CURSOR_TTL = 10000, CURSOR_INTERVAL = 200;
export type CursorPoint = { x: number; y: number };
export type CursorDecoration = { id: string; title: string; artKey: string; color: string; kind?: string };
export type SharedCursor = CursorPoint & { playerId: string; name: string; color: string; badge?:string|null;cursorStyle?:string|null;level?:number;decoration?:CursorDecoration|null; updatedAt: number };
export type CursorMemberMeta = { id: string; name: string; color: string; badge?: string | null; cursorStyle?: string | null; level?: number; decoration?: CursorDecoration | null };
export function enrichCursorFromMember(cursor: SharedCursor, member: CursorMemberMeta | undefined, preferMember = false): SharedCursor {
  if (!member) return cursor;
  const name = preferMember ? member.name : (cursor.name || member.name);
  const color = preferMember ? member.color : (cursor.color || member.color);
  const level = preferMember ? member.level : (cursor.level !== undefined ? cursor.level : member.level);
  const decoration = preferMember ? member.decoration : (cursor.decoration !== undefined ? cursor.decoration : member.decoration);
  const badge = preferMember ? member.badge : (cursor.badge !== undefined ? cursor.badge : member.badge);
  const cursorStyle = preferMember ? member.cursorStyle : (cursor.cursorStyle !== undefined ? cursor.cursorStyle : member.cursorStyle);
  return {
    playerId: cursor.playerId, x: cursor.x, y: cursor.y, updatedAt: cursor.updatedAt, name, color,
    ...(level !== undefined ? { level } : {}),
    ...(decoration !== undefined ? { decoration } : {}),
    ...(badge !== undefined ? { badge } : {}),
    ...(cursorStyle !== undefined ? { cursorStyle } : {}),
  };
}
export function enrichCursorsFromMembers(cursors: SharedCursor[], members: readonly CursorMemberMeta[] | undefined): SharedCursor[] {
  if (!members?.length) return cursors;
  const byId = new Map(members.map(m => [m.id, m]));
  return cursors.map(cursor => enrichCursorFromMember(cursor, byId.get(cursor.playerId), false));
}
export type CursorInput = { clientId: string; seq: number; point: CursorPoint | null };
export function cursorInput(input: unknown): CursorInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as CursorInput;
  if (!/^[a-f0-9]{32}$/.test(value.clientId) || !Number.isSafeInteger(value.seq) || value.seq < 0 || value.seq > 1e9) return null;
  if (value.point === null) return { clientId: value.clientId, seq: value.seq, point: null };
  if (!value.point || !Number.isFinite(value.point.x) || !Number.isFinite(value.point.y) ||
    value.point.x < WORLD.x || value.point.x > WORLD.x+WORLD.width || value.point.y < WORLD.y || value.point.y > WORLD.y+WORLD.height) return null;
  return { clientId: value.clientId, seq: value.seq, point: { x: value.point.x, y: value.point.y } };
}
export function cursorWorld(client: CursorPoint, rect: { left: number; top: number; width: number; height: number }, camera: { x: number; y: number; z: number },world:typeof WORLD=WORLD): CursorPoint | null {
  const px=client.x-rect.left, py=client.y-rect.top;
  if (px<0 || py<0 || px>rect.width || py>rect.height || camera.z<=0) return null;
  const x=(px-camera.x)/camera.z,y=(py-camera.y)/camera.z;
  return x>=world.x && y>=world.y && x<=world.x+world.width && y<=world.y+world.height ? { x:Math.round(x*10)/10,y:Math.round(y*10)/10 } : null;
}
export function cursorScreen(point: CursorPoint, camera: { x: number; y: number; z: number }) {
  return { x:camera.x+point.x*camera.z, y:camera.y+point.y*camera.z };
}
