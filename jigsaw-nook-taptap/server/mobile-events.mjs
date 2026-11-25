/** Shared recorder for room events and future level-start / level-clear callers. */
export function createMobileEvents({db}){
 db.exec(`CREATE TABLE IF NOT EXISTS mobile_events(id INTEGER PRIMARY KEY,owner TEXT,kind TEXT,room_id TEXT,data TEXT,created_at INTEGER);
 CREATE INDEX IF NOT EXISTS mobile_events_kind_created_at ON mobile_events(kind,created_at);`);
 function record(owner,kind,roomId,data={},now=Date.now()){
  try{db.prepare('INSERT INTO mobile_events(owner,kind,room_id,data,created_at) VALUES(?,?,?,?,?)').run(owner,kind,roomId,JSON.stringify(data),now);}
  catch(error){console.error('Mobile event write failed:',kind,error);}
 }
 return {record};
}
