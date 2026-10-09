import { requireAccount } from './account-store';
import { verifiedPassword } from './account-security';
import { localDb } from './local-db';
import { settings } from './site-settings';
import { RoomError } from './room-engine';

export async function requireAdmin(request:Request) {
  const account=await requireAccount(request);
  const ids=(settings().PUZZLE_ADMIN_IDS||'').split(',').map(s=>s.trim()).filter(s=>/^[a-f0-9]{32}$/.test(s));
  if(!ids.includes(account.id))throw new RoomError('此账号没有管理权限',403);
  return account;
}
export async function adminOverview(request:Request) {
  await requireAdmin(request);const db=localDb();
  const [requests,rooms,accounts,scores,audit]=await Promise.all([
    db.prepare(`SELECT p.user_id AS id,u.username,u.name,p.status,p.created_at,p.resolution FROM puzzle_privacy_requests p JOIN puzzle_users u ON u.id=p.user_id ORDER BY p.updated_at DESC LIMIT 100`).all(),
    db.prepare(`SELECT d.room_id AS id,d.title,d.visibility,COALESCE(m.closed,0) AS closed FROM puzzle_room_directory d LEFT JOIN puzzle_room_moderation m ON m.room_id=d.room_id WHERE d.expires_at>? ORDER BY d.created_at DESC LIMIT 100`).bind(Date.now()).all(),
    db.prepare(`SELECT u.id,u.username,u.name,COALESCE(s.status,'active') AS status FROM puzzle_users u LEFT JOIN puzzle_account_security s ON s.user_id=u.id ORDER BY u.created_at DESC LIMIT 100`).all(),
    db.prepare(`SELECT r.room_id AS id,r.image_id,r.piece_count,r.elapsed_ms,r.completed_at,COALESCE(m.hidden,0) AS hidden FROM puzzle_results r LEFT JOIN puzzle_score_moderation m ON m.room_id=r.room_id ORDER BY r.completed_at DESC LIMIT 100`).all(),
    db.prepare('SELECT action,target_id,reason,created_at FROM puzzle_admin_audit ORDER BY created_at DESC LIMIT 50').all()
  ]);
  return {requests:requests.results,rooms:rooms.results,accounts:accounts.results,scores:scores.results,audit:audit.results,feedbackAdminUrl:settings().PUZZLE_FEEDBACK_ADMIN_URL||null};
}
export async function adminAction(request:Request,input:Record<string,unknown>) {
  const admin=await requireAdmin(request);await verifiedPassword(request,input.password);
  const target=typeof input.target==='string'?input.target:'',reason=typeof input.reason==='string'?input.reason.trim():'';
  if(!/^[a-f0-9]{32}$/.test(target)||reason.length<4||reason.length>500)throw new RoomError('请选择对象，并填写 4–500 个字符的处理原因');
  const db=localDb(),statements=[];
  switch(input.action){
    case 'close-room':case 'open-room':
      statements.push(db.prepare(`INSERT INTO puzzle_room_moderation (room_id,closed) SELECT id,? FROM puzzle_rooms WHERE id=? ON CONFLICT(room_id) DO UPDATE SET closed=excluded.closed`).bind(input.action==='close-room'?1:0,target));break;
    case 'hide-score':case 'show-score':
      statements.push(db.prepare(`INSERT INTO puzzle_score_moderation (room_id,hidden) SELECT room_id,? FROM puzzle_results WHERE room_id=? ON CONFLICT(room_id) DO UPDATE SET hidden=excluded.hidden`).bind(input.action==='hide-score'?1:0,target));break;
    case 'suspend-account':case 'restore-account':
      if(target===admin.id)throw new RoomError('不能暂停当前管理员账号',400);
      statements.push(db.prepare(`INSERT INTO puzzle_account_security (user_id,status) SELECT id,? FROM puzzle_users WHERE id=? ON CONFLICT(user_id) DO UPDATE SET status=excluded.status`).bind(input.action==='suspend-account'?'suspended':'active',target));
      if(input.action==='suspend-account')statements.push(db.prepare('DELETE FROM puzzle_sessions WHERE user_id=?').bind(target));break;
    case 'resolve-privacy':
      // Closing a request records the operator's actual resolution. It does not
      // pretend to erase shared puzzle records or backups automatically.
      statements.push(db.prepare("UPDATE puzzle_privacy_requests SET status='completed',resolution=?,updated_at=? WHERE user_id=? AND status='pending'").bind(reason,Date.now(),target));break;
    default:throw new RoomError('请求格式无效');
  }
  statements.push(db.prepare('INSERT INTO puzzle_admin_audit (id,actor_id,action,target_id,reason,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID().replaceAll('-',''),admin.id,input.action,target,reason,Date.now()));
  const results=await db.batch(statements);
  if(results[0].meta.changes!==1)throw new RoomError('对象不存在或状态已变化，请刷新后重试',409);
  return {ok:true};
}
