import { WORLD } from './puzzle-engine';

export const CURSOR_INTERVAL = 200;
// Hidden browser tabs can batch timers once per minute. Allow two heartbeat
// windows for pointer presence, while the room's seats/drag leases keep their
// existing shorter timeout. Explicit leave/stop still removes the cursor now.
export const CURSOR_ONLINE_MS = 120000;
export type CursorPoint = { x: number; y: number };
export type SharedCursor = CursorPoint & { playerId: string; name: string; color: string; badge?:string|null;cursorStyle?:string|null; updatedAt: number };
export type CursorInput = { clientId: string; seq: number; point: CursorPoint | null };
export function cursorInput(input: unknown,world:typeof WORLD=WORLD): CursorInput | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as CursorInput;
  if (!/^[a-f0-9]{32}$/.test(value.clientId) || !Number.isSafeInteger(value.seq) || value.seq < 0 || value.seq > 1e9) return null;
  if (value.point === null) return { clientId: value.clientId, seq: value.seq, point: null };
  if (!value.point || !Number.isFinite(value.point.x) || !Number.isFinite(value.point.y) ||
    value.point.x < 0 || value.point.x > world.width || value.point.y < 0 || value.point.y > world.height) return null;
  return { clientId: value.clientId, seq: value.seq, point: { x: value.point.x, y: value.point.y } };
}
export function cursorWorld(client: CursorPoint, rect: { left: number; top: number; width: number; height: number }, camera: { x: number; y: number; z: number },world:typeof WORLD=WORLD): CursorPoint | null {
  const px=client.x-rect.left, py=client.y-rect.top;
  if (px<0 || py<0 || px>rect.width || py>rect.height || camera.z<=0) return null;
  const x=(px-camera.x)/camera.z,y=(py-camera.y)/camera.z;
  return x>=0 && y>=0 && x<=world.width && y<=world.height ? { x:Math.round(x*10)/10,y:Math.round(y*10)/10 } : null;
}
export function cursorScreen(point: CursorPoint, camera: { x: number; y: number; z: number }) {
  return { x:camera.x+point.x*camera.z, y:camera.y+point.y*camera.z };
}
