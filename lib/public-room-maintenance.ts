import { localDb } from './local-db';
import { cleanupPublicRooms } from '../server/public-room-cleanup.mjs';
let nextRun=0,pending:Promise<unknown>|undefined;
export function maintainPublicRooms(){
  if(pending)return pending;
  if(Date.now()<nextRun)return Promise.resolve();
  pending=cleanupPublicRooms(localDb()).then(()=>{nextRun=Date.now()+15000;}).finally(()=>{pending=undefined;});
  return pending;
}
