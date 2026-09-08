import { env } from 'cloudflare:workers';
import { RoomError } from './room-engine';
export function localDb(){const database=(env as unknown as {PUZZLE_DB?:D1Database}).PUZZLE_DB;if(!database)throw new RoomError('本地服务正在准备，请稍后再试',503);return database.withSession('first-primary');}
