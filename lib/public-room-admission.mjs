// Insert the room and directory in one transaction. Concurrent create requests
// must observe the first empty table instead of each persisting another one.
export async function insertOrReuseEmptyPublicRoom(database,room,pieces,now,onlineMs){
 if(room.visibility!=='public'||room.customImage)throw Error('Only catalog public rooms may be reused');
 const candidate=`FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id
 WHERE d.visibility='public' AND d.image_id=? AND d.piece_count=? AND d.title=?
 AND d.completed_at IS NULL AND d.expires_at>? AND d.slot IS NULL
 AND json_extract(r.data,'$.completedAt') IS NULL AND json_extract(r.data,'$.startedAt') IS NULL
 AND COALESCE(json_extract(r.data,'$.acceptingNew'),1)=1
 AND COALESCE(json_extract(r.data,'$.botRoom'),0)=0 AND json_extract(r.data,'$.customImage') IS NULL
 AND json_extract(r.data,'$.puzzle.cols')=? AND json_extract(r.data,'$.puzzle.rows')=?
 AND COALESCE(json_extract(r.data,'$.puzzle.scatterVersion'),1)=?
 AND NOT EXISTS(SELECT 1 FROM json_each(r.data,'$.puzzle.groups') g WHERE json_extract(g.value,'$.locked')=1 OR json_array_length(json_extract(g.value,'$.pieces'))>1)
 AND (SELECT COUNT(*) FROM json_each(r.data,'$.members') m WHERE CAST(json_extract(m.value,'$.lastSeen') AS INTEGER)>?)<8
 AND NOT EXISTS(SELECT 1 FROM puzzle_room_moderation m WHERE m.room_id=r.id AND m.closed=1)`;
 const args=[room.puzzle.imageId,pieces,room.title,now,room.puzzle.cols,room.puzzle.rows,room.puzzle.scatterVersion??1,now-onlineMs];
 const [inserted]=await database.batch([
  database.prepare(`INSERT INTO puzzle_rooms(id,revision,data,expires_at) SELECT ?,0,?,? WHERE NOT EXISTS(SELECT 1 ${candidate})`).bind(room.id,JSON.stringify(room),room.expiresAt,...args),
  database.prepare(`INSERT INTO puzzle_room_directory(room_id,visibility,owner_id,title,image_id,piece_count,created_at,expires_at,completed_at,slot)
   SELECT ?,'public',?,?,?,?,?,?,NULL,NULL WHERE EXISTS(SELECT 1 FROM puzzle_rooms WHERE id=?)`).bind(room.id,room.ownerId??null,room.title,room.puzzle.imageId,pieces,room.createdAt,room.expiresAt,room.id)
 ]);
 if(inserted.meta.changes===1)return {id:room.id,created:true};
 const existing=await database.prepare(`SELECT r.id ${candidate} ORDER BY d.created_at,r.id LIMIT 1`).bind(...args).first();
 // A table may start or fill up between the atomic insert and this read. A retry
 // can create a new table then; never return an expired, private or full table.
 return existing?{id:existing.id,created:false}:null;
}
