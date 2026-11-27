import { applyAction, ensureOpen, pruneLeases, RoomError, type Member, type Room } from './room-engine';
import { neighbors, snapTolerance, type Group } from './puzzle-engine';
import { achievementOwner, recordRoomContribution } from './room-achievements';
import { clearSharedActionLease } from './shared-actions';
import { SOLO_BATCH_MAX, type SoloBatchReceipt } from './solo-play';

export type BatchContributedOp = { requestId: string; groupId: number; forgiving: boolean };
export type RoomBatchResult = { soloBatch: SoloBatchReceipt; contributedOps: BatchContributedOp[] };

const MAX_RECEIPTS_PER_OWNER = 256;
const requestKey = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

function validOp(op: any): boolean {
  if (!op || typeof op !== 'object' || !requestKey(op.requestId)
    || !Number.isSafeInteger(op.groupId) || op.groupId < 0
    || !Number.isFinite(op.dx) || !Number.isFinite(op.dy)
    || Math.abs(op.dx) > 20000 || Math.abs(op.dy) > 20000) return false;
  if (op.pieceId !== undefined && (!Number.isSafeInteger(op.pieceId) || op.pieceId < 0)) return false;
  if (op.snapKind !== undefined && op.snapKind !== 'lock' && op.snapKind !== 'join') return false;
  if (op.mergedPieces !== undefined && (!Array.isArray(op.mergedPieces) || op.mergedPieces.length > 8 || !op.mergedPieces.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0))) return false;
  return true;
}

function restoreRoom(target: Room, backup: Room, memberMap: Map<string, Member>) {
  const restoredMembers = backup.members.map(saved => {
    const live = memberMap.get(saved.id);
    if (!live) return saved;
    for (const key of Object.keys(live)) delete (live as any)[key];
    Object.assign(live, saved);
    return live;
  });
  for (const key of Object.keys(target)) delete (target as any)[key];
  Object.assign(target, { ...backup, members: restoredMembers });
}

function recordPlayerSnaps(room: Room, ownerKey: string, beforeGroups: Group[], groupId: number) {
  const beforeGroup = beforeGroups.find(g => g.id === groupId);
  const afterGroup = room.puzzle.groups.find(g => g.id === groupId);
  if (!beforeGroup || !afterGroup) return;
  const snaps = (room.playerSnaps ??= {})[ownerKey] ??= { keys: [], forgiving: 0 };
  const keySet = new Set(snaps.keys), { cols, rows } = room.puzzle;
  const beforePieces = new Set(beforeGroup.pieces);
  const addedPieces = afterGroup.pieces.filter(id => !beforePieces.has(id));
  if (addedPieces.length) {
    const addedSet = new Set(addedPieces);
    for (const piece of beforePieces) {
      for (const n of neighbors(piece, cols, rows)) {
        if (addedSet.has(n)) keySet.add(`J:${Math.min(piece, n)}:${Math.max(piece, n)}`);
      }
    }
  }
  if (afterGroup.locked) {
    const beforeLocked = new Set(beforeGroups.filter(g => g.locked).flatMap(g => g.pieces));
    for (const piece of afterGroup.pieces) {
      if (!beforeLocked.has(piece)) keySet.add(`L:${piece}`);
    }
  }
  snaps.keys = [...keySet];
}

function saveReceipt(room: Room, ownerKey: string, requestId: string, hash: string, now: number) {
  const bucket = (room.batchReceipts ??= {})[ownerKey] ??= {};
  bucket[requestId] = { hash, at: now };
  const entries = Object.entries(bucket);
  if (entries.length > MAX_RECEIPTS_PER_OWNER) {
    entries.sort((a, b) => a[1].at - b[1].at);
    for (const [oldId] of entries.slice(0, entries.length - MAX_RECEIPTS_PER_OWNER)) delete bucket[oldId];
  }
}

export function applyRoomBatch(room: Room, member: Member, input: any, now: number): RoomBatchResult {
  if (!Array.isArray(input?.ops) || input.ops.length < 1 || input.ops.length > SOLO_BATCH_MAX) {
    throw Object.assign(new RoomError('同步内容无效', 400), { code: 'INVALID_BATCH' });
  }
  ensureOpen(room, now);
  pruneLeases(room, now);
  const owner = achievementOwner(member);
  const ownerKey = owner ?? member.id;
  const applied: string[] = [];
  const skipped: { requestId: string | null; code: string }[] = [];
  const contributedOps: BatchContributedOp[] = [];
  const totalPieces = room.puzzle.cols * room.puzzle.rows;
  const tol = snapTolerance(room.puzzle);

  for (const op of input.ops) {
    if (!validOp(op)) {
      skipped.push({ requestId: typeof op?.requestId === 'string' ? op.requestId : null, code: 'INVALID_OP' });
      continue;
    }
    const { requestId, groupId, dx, dy } = op;
    const fingerprint = `${groupId}:${dx}:${dy}`;
    const existing = room.batchReceipts?.[ownerKey]?.[requestId];
    if (existing) {
      if (existing.hash !== fingerprint) {
        skipped.push({ requestId, code: 'REQUEST_CONFLICT' });
        continue;
      }
      applied.push(requestId);
      continue;
    }

    const backup = structuredClone(room);
    const memberMap = new Map(room.members.map(m => [m.id, m]));
    try {
      ensureOpen(room, now);
      pruneLeases(room, now);
      const leasedByOther = (id: number) => {
        const lease = room.leases[id];
        return !!lease && lease.expires > now && lease.playerId !== member.id;
      };
      const runDrop = (targetGroupId: number, targetDx: number, targetDy: number) => {
        const beforeGroups = structuredClone(room.puzzle.groups);
        const beforeCount = owner ? (room.achievements?.contributors?.[owner]?.count ?? 0) : 0;
        for (const [id, lease] of Object.entries(room.leases)) {
          if (Number(id) !== targetGroupId && lease.playerId === member.id) delete room.leases[id];
        }
        applyAction(room, member, { type: 'claim', groupId: targetGroupId }, now);
        applyAction(room, member, { type: 'drop', groupId: targetGroupId, dx: targetDx, dy: targetDy, seq: 1 }, now);
        clearSharedActionLease(room, member, { type: 'drop', groupId: targetGroupId });
        const afterCount = owner ? (room.achievements?.contributors?.[owner]?.count ?? 0) : 0;
        if (afterCount > beforeCount) {
          recordPlayerSnaps(room, ownerKey, beforeGroups, targetGroupId);
          contributedOps.push({ requestId, groupId: targetGroupId, forgiving: false });
        }
      };
      const awardForgiving = (snapKey: string) => {
        const firstJoinedAt = room.memberJoinedAt?.[ownerKey] ?? member.joinedAt ?? now;
        if (room.completedAt !== null && firstJoinedAt > room.completedAt) {
          throw new RoomError('拼图已完成，无法同步该步', 409);
        }
        member.lastSeen = now;
        if (owner) (room.participants ??= {})[owner] = member.name;
        const snaps = (room.playerSnaps ??= {})[ownerKey] ??= { keys: [], forgiving: 0 };
        const currentCount = owner ? (room.achievements?.contributors?.[owner]?.count ?? 0) : 0;
        if (snaps.keys.includes(snapKey) || currentCount >= totalPieces || snaps.forgiving >= totalPieces) return;
        recordRoomContribution(room, member, now);
        snaps.keys.push(snapKey);
        snaps.forgiving++;
        contributedOps.push({ requestId, groupId, forgiving: true });
      };

      const hasPiece = op.pieceId !== undefined && op.pieceId < totalPieces;
      if (!hasPiece || (op.snapKind !== 'lock' && op.snapKind !== 'join')) {
        runDrop(groupId, dx, dy);
      } else {
        const group = room.puzzle.groups.find(g => g.pieces.includes(op.pieceId));
        if (!group) throw new RoomError('这组拼块已合并或归位，请重新选择', 409);
        const pieceNeighbors = new Set(neighbors(op.pieceId, room.puzzle.cols, room.puzzle.rows));
        const validTargets: number[] = Array.isArray(op.mergedPieces)
          ? op.mergedPieces.filter((q: number) => q < totalPieces && pieceNeighbors.has(q))
          : [];
        if (op.snapKind === 'lock') {
          const plausibleLock = Math.hypot(dx, dy) <= tol || validTargets.length > 0;
          if (group.locked) {
            if (!plausibleLock) throw new RoomError('这组拼块已归位', 409);
            awardForgiving(`L:${op.pieceId}`);
          } else {
            if (leasedByOther(group.id)) throw new RoomError('这组拼块正被另一位玩家移动', 409);
            if (plausibleLock) {
              if (group.id === groupId && Math.hypot(dx, dy) <= tol) runDrop(groupId, dx, dy);
              else runDrop(group.id, 0, 0);
            } else {
              runDrop(group.id, dx, dy);
            }
          }
        } else if (!validTargets.length) {
          runDrop(group.id, dx, dy);
        } else {
          const isJoined = (q: number) =>
            group.pieces.includes(q) || (group.locked && room.puzzle.groups.find(g => g.pieces.includes(q))?.locked === true);
          const unjoined = validTargets.filter(q => !isJoined(q));
          if (!unjoined.length) {
            const q = validTargets[0];
            awardForgiving(`J:${Math.min(op.pieceId, q)}:${Math.max(op.pieceId, q)}`);
          } else if (group.locked) {
            const candidate = unjoined
              .map(q => room.puzzle.groups.find(g => g.pieces.includes(q)))
              .find(target => target && !target.locked && !leasedByOther(target.id));
            if (!candidate) throw new RoomError('这组拼块正被另一位玩家移动', 409);
            runDrop(candidate.id, 0, 0);
          } else {
            if (leasedByOther(group.id)) throw new RoomError('这组拼块正被另一位玩家移动', 409);
            const targetGroup = unjoined
              .map(q => room.puzzle.groups.find(g => g.pieces.includes(q)))
              .find(target => target && target.id !== group.id && !leasedByOther(target.id));
            if (!targetGroup) throw new RoomError('这组拼块正被另一位玩家移动', 409);
            const tDx = targetGroup.locked ? 0 : targetGroup.dx;
            const tDy = targetGroup.locked ? 0 : targetGroup.dy;
            if (group.id === groupId && Math.hypot(tDx - dx, tDy - dy) <= tol) runDrop(groupId, dx, dy);
            else runDrop(group.id, tDx, tDy);
          }
        }
      }
      saveReceipt(room, ownerKey, requestId, fingerprint, now);
      applied.push(requestId);
    } catch (error) {
      restoreRoom(room, backup, memberMap);
      const status = (error as { status?: number })?.status;
      if (status && [400, 403, 409, 410, 422].includes(status)) {
        skipped.push({ requestId, code: (error as { code?: string })?.code || 'CONFLICT' });
        continue;
      }
      throw error;
    }
  }

  return { soloBatch: { applied, skipped, stopped: null }, contributedOps };
}
