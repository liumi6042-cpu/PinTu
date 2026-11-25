import { betaCapacity } from './site-settings';
import { localDb } from './local-db';
import { RoomError } from './room-engine';

// All admissions use one SQL statement, including across Worker isolates.
const renewed=new Map<string,number>();
export async function ensureBetaSeat(identity:string,now=Date.now()) {
  const capacity=betaCapacity();if(!capacity)return;
  if((renewed.get(identity)||0)>now)return;
  const result=await localDb().prepare(`INSERT INTO puzzle_beta_seats (identity,expires_at)
    SELECT ?,? WHERE EXISTS(SELECT 1 FROM puzzle_beta_seats WHERE identity=? AND expires_at>?)
    OR (SELECT COUNT(*) FROM puzzle_beta_seats WHERE expires_at>?)<?
    ON CONFLICT(identity) DO UPDATE SET expires_at=excluded.expires_at`)
    .bind(identity,now+22000,identity,now,now,capacity).run();
  if(result.meta.changes!==1)throw new RoomError('测试席位暂满，请稍后再来；你也可以先玩本机单人拼图',429);
  if(renewed.size>=1024)renewed.delete(renewed.keys().next().value!);
  renewed.set(identity,now+5000);
  if(Math.random()<.05)await localDb().prepare('DELETE FROM puzzle_beta_seats WHERE expires_at<=?').bind(now).run();
}
