import { DatabaseSync } from 'node:sqlite';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function testDatabase(){
  if(process.env.PUZZLE_TEST_LOCAL!=='1')throw new Error('Local database fixtures require PUZZLE_TEST_LOCAL=1');
  const root=fileURLToPath(new URL('../.wrangler/state/v3/d1/',import.meta.url));
  async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink())continue;const file=path.join(dir,item.name);if(item.isDirectory()){const db=await walk(file);if(db)return db;}else if(item.name.endsWith('.sqlite')){const db=new DatabaseSync(file,{timeout:10000});if(db.prepare("SELECT name FROM sqlite_master WHERE name='puzzle_rooms'").get())return db;db.close();}}}
  const db=await walk(root);if(!db)throw new Error('Local puzzle database not initialized');return db;
}
export function cleanupFixtureRooms(db,ids,owners=[]){
  if(!ids.every(id=>/^[a-f0-9]{32}$/.test(id)))throw new Error('Unsafe fixture identifiers');
  const marks=ids.map(()=>'?').join(',');if(ids.length)for(const table of ['puzzle_result_players','puzzle_achievement_settled','puzzle_achievement_facts','puzzle_room_cursors','puzzle_results','puzzle_room_directory','puzzle_rooms'])db.prepare(`DELETE FROM ${table} WHERE ${table==='puzzle_rooms'?'id':'room_id'} IN (${marks})`).run(...ids);
  if(owners.length){for(const table of ['puzzle_achievement_profiles','puzzle_achievement_awards','puzzle_achievement_days'])db.prepare(`DELETE FROM ${table} WHERE owner_id IN (${owners.map(()=>'?').join(',')})`).run(...owners);if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='puzzle_beta_seats'").get())db.prepare(`DELETE FROM puzzle_beta_seats WHERE identity IN (${owners.map(()=>'?').join(',')})`).run(...owners);}
}
