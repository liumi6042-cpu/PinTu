import { insertPlayableRoom, newPlayableRoom } from './lobby-store';
import { localDb } from './local-db';
import { applyAction, COLORS, type BotTask, type Member, type Room } from './room-engine';
import { supportsPieceCount } from './piece-policy';
import { GALLERY_VISIBLE_PHOTOS } from './puzzle-catalog';
import { mutateRoom, newId } from './room-store';
import { neighbors } from './puzzle-engine';

const BOT_DELAY_MIN = 7000, BOT_DELAY_MAX = 12000;
const BOT_NAME_ROTATE_MS = 30 * 60 * 1000;
const SLOTS = ['bot-500-a', 'bot-500-b'] as const;
const BOT_ACCOUNTS = ['bot-account-lin-xiaolu', 'bot-account-xi-songsu', 'bot-account-yueguang', 'bot-account-hupan'] as const;
const BOT_NAMES = [
  '林间小鹿', '溪边松鼠', '月光猫头鹰', '湖畔小熊',
  '晨雾松鼠', '橘子汽水', '晚风旅人', '云上白鹭',
  '青石听雨', '桂花小巷', '薄荷星河', '南窗夜话',
  '麦田守望', '山茶微光', '海盐苏打', '秋日信笺',
  '竹影清风', '莓果奶糖', '远山来信', '银杏漫步',
  '月下纸鸢', '森林邮差', '小岛晴天', '落日船歌',
  '微风拾光', '蓝莓星球', '栀子花开', '雪松先生',
] as const;

function botRoomTitle(slot: string) {
  return slot === SLOTS[1] ? '月下湖畔' : '林间晨雾';
}

function secretNumber(seed: string) { let value = 0; for (const ch of seed) value = (value * 31 + ch.charCodeAt(0)) >>> 0; return value; }
function delayFor(member: Member, now: number) { const n = secretNumber(member.id + String(now)); return BOT_DELAY_MIN + n % (BOT_DELAY_MAX - BOT_DELAY_MIN + 1); }
function pauseFor(member: Member, now: number, wrong: boolean) {
  const n = secretNumber(`pause:${member.id}:${now}`);
  return (wrong ? 2500 : 1200) + n % (wrong ? 3500 : 2200);
}
function shouldMisplace(member: Member, groupId: number, now: number) {
  return secretNumber(`mistake:${member.id}:${groupId}:${Math.floor(now / 30000)}`) % 100 < 18;
}
function taskFor(room: Room, bot: Member) { return room.botState?.tasks?.[bot.id]; }
function botPhoto(index: number) {
  const options = GALLERY_VISIBLE_PHOTOS.filter(photo => supportsPieceCount(photo.id, 500));
  return options[index % Math.max(1, options.length)]?.id || GALLERY_VISIBLE_PHOTOS[0]?.id;
}
function addBots(room: Room, slotIndex: number, now: number) {
  const start = slotIndex * 2;
  room.members = [0, 1].map(index => ({
    id: newId(), name: BOT_NAMES[start + index], accountId: BOT_ACCOUNTS[start + index],
    color: COLORS[(slotIndex * 2 + index) % COLORS.length], digest: newId(), joinedAt: now,
    lastSeen: now, bot: true,
  }));
  room.botState = {
    nextAt: Object.fromEntries(room.members.map((member, index) => [member.id, now + 3500 + index * 1800])),
    tasks: {},
  };
}

async function activeRoomFor(slot: string) {
  return localDb().prepare("SELECT r.id FROM puzzle_room_directory d JOIN puzzle_rooms r ON r.id=d.room_id WHERE d.slot=? AND d.completed_at IS NULL").bind(slot).first<{ id: string }>();
}

async function ensureRoom(slot: string, index: number, now: number) {
  if (await activeRoomFor(slot)) return false;
  const imageId = botPhoto(index);
  if (!imageId) return false;
  const room = newPlayableRoom(newId(), imageId, 500, 'public', undefined, now);
  room.title = botRoomTitle(slot);
  room.botRoom = true; room.botRoomSlot = slot; addBots(room, index, now);
  await insertPlayableRoom(room, slot);
  return true;
}

function isBorderPiece(pieceId: number, cols: number, rows: number) {
  const row = Math.floor(pieceId / cols), col = pieceId % cols;
  return row === 0 || col === 0 || row === rows - 1 || col === cols - 1;
}

function touchesLocked(group: Room['puzzle']['groups'][number], groups: Room['puzzle']['groups'], cols: number, rows: number) {
  const occupied = new Set(groups.filter(candidate => candidate.locked).flatMap(candidate => candidate.pieces));
  return group.pieces.some(piece => neighbors(piece, cols, rows).some(neighbor => occupied.has(neighbor)));
}

function chooseGroup(room: Room, bot: Member) {
  const held = new Set(Object.keys(room.leases).map(Number));
  const available = room.puzzle.groups.filter(group => !group.locked && !held.has(group.id));
  if (!available.length) return undefined;

  const hasLooseBorder = available.some(group => group.pieces.some(piece => isBorderPiece(piece, room.puzzle.cols, room.puzzle.rows)));
  const border = available.filter(group => group.pieces.some(piece => isBorderPiece(piece, room.puzzle.cols, room.puzzle.rows)));
  const frontier = available.filter(group => touchesLocked(group, room.puzzle.groups, room.puzzle.cols, room.puzzle.rows));
  const candidates = hasLooseBorder ? border : frontier.length ? frontier : available;
  const ranked = [...candidates].sort((a, b) => {
    const aBorder = a.pieces.filter(piece => isBorderPiece(piece, room.puzzle.cols, room.puzzle.rows)).length;
    const bBorder = b.pieces.filter(piece => isBorderPiece(piece, room.puzzle.cols, room.puzzle.rows)).length;
    return bBorder - aBorder || a.pieces.length - b.pieces.length || a.id - b.id;
  });
  // Humans tend to choose one of the few pieces currently in reach. Keep a small
  // deterministic shuffle so the four bots do not trace the same edge clockwise.
  const top = ranked.slice(0, Math.min(5, ranked.length));
  const pick = secretNumber(`pick:${room.puzzle.seed}:${bot.id}:${room.revision}`) % top.length;
  return top[pick];
}

function clearTask(room: Room, bot: Member, now: number, extra = 0) {
  if (!room.botState) return;
  delete room.botState.tasks?.[bot.id];
  room.botState.nextAt[bot.id] = now + delayFor(bot, now) + extra;
}

function startTask(room: Room, bot: Member, now: number) {
  const group = chooseGroup(room, bot);
  if (!group || !room.botState) return false;
  (room.botState.tasks ??= {})[bot.id] = { groupId: group.id, phase: 'claim', wrong: shouldMisplace(bot, group.id, now), seq: 0 };
  room.botState.nextAt[bot.id] = now;
  return true;
}

function normalizeBots(room: Room, now: number) {
  if (!room.botRoom || !room.botState) return;
  room.title = botRoomTitle(room.botRoomSlot || SLOTS[0]);
  const slotIndex = room.botRoomSlot === SLOTS[1] ? 1 : 0;
  const nameEpoch = Math.floor(now / BOT_NAME_ROTATE_MS);
  const usedNames = new Set<string>();
  const bots = room.members.filter(member => member.bot);
  for (const [index, bot] of bots.slice(0, 2).entries()) {
    const start = secretNumber(`bot-name:${room.id}:${bot.id}:${nameEpoch}`) % BOT_NAMES.length;
    let botIndex = start;
    while (usedNames.has(BOT_NAMES[botIndex])) botIndex = (botIndex + 1) % BOT_NAMES.length;
    usedNames.add(BOT_NAMES[botIndex]);
    bot.bot = true;
    bot.name = BOT_NAMES[botIndex];
    bot.accountId ??= BOT_ACCOUNTS[(slotIndex * 2 + index) % BOT_ACCOUNTS.length];
    room.botState.nextAt[bot.id] ??= now + 3500 + index * 1800;
  }
}

function performTask(room: Room, bot: Member, task: BotTask, now: number) {
  const group = room.puzzle.groups.find(candidate => candidate.id === task.groupId);
  if (!group || group.locked) { clearTask(room, bot, now); return; }
  if (task.phase === 'claim') {
    applyAction(room, bot, { type: 'claim', groupId: task.groupId }, now);
    task.phase = 'approach'; task.seq = 1;
    room.botState!.nextAt[bot.id] = now + pauseFor(bot, now, false);
    return;
  }
  if (task.phase === 'approach') {
    applyAction(room, bot, { type: 'move', groupId: task.groupId, dx: group.dx * .48, dy: group.dy * .48, seq: task.seq }, now);
    task.phase = 'align'; task.seq++;
    room.botState!.nextAt[bot.id] = now + pauseFor(bot, now, false);
    return;
  }
  if (task.phase === 'align') {
    const wrongOffset = task.wrong ? { dx: 72, dy: -64 } : { dx: 0, dy: 0 };
    applyAction(room, bot, { type: 'move', groupId: task.groupId, ...wrongOffset, seq: task.seq }, now);
    task.phase = 'drop'; task.seq++;
    room.botState!.nextAt[bot.id] = now + pauseFor(bot, now, task.wrong);
    return;
  }
  if (task.wrong) {
    applyAction(room, bot, { type: 'drop', groupId: task.groupId, dx: 72, dy: -64, seq: task.seq }, now);
    task.wrong = false;
    task.phase = 'reclaim';
    task.seq++;
    room.botState!.nextAt[bot.id] = now + pauseFor(bot, now, true);
    return;
  }
  applyAction(room, bot, { type: 'drop', groupId: task.groupId, dx: 0, dy: 0, seq: task.seq }, now);
  clearTask(room, bot, now);
}

function reclaimTask(room: Room, bot: Member, task: BotTask, now: number) {
  const group = room.puzzle.groups.find(candidate => candidate.id === task.groupId);
  if (!group || group.locked) { clearTask(room, bot, now); return; }
  applyAction(room, bot, { type: 'claim', groupId: task.groupId }, now);
  task.phase = 'approach';
  task.seq++;
  room.botState!.nextAt[bot.id] = now + pauseFor(bot, now, false);
}

async function playOne(roomId: string, now: number) {
  await mutateRoom(roomId, room => {
    if (!room.botRoom || room.completedAt) return;
    room.botState ??= { nextAt: {}, tasks: {} };
    room.botState.tasks ??= {};
    normalizeBots(room, now);
    const bots = room.members.filter(member => member.bot);
    // Keep the practice seats visibly online even while a bot is waiting for its next move.
    for (const bot of bots) {
      const task = taskFor(room, bot);
      applyAction(room, bot, task ? { type: 'heartbeat', groupId: task.groupId } : { type: 'heartbeat' }, now);
    }
    for (const bot of bots) {
      if ((room.botState.nextAt[bot.id] || 0) > now) continue;
      const task = taskFor(room, bot);
      try {
        if (task?.phase === 'reclaim') reclaimTask(room, bot, task, now);
        else if (task) performTask(room, bot, task, now);
        else if (!startTask(room, bot, now)) room.botState.nextAt[bot.id] = now + delayFor(bot, now);
      } catch {
        // A human may have taken the group between phases. The bot releases its
        // stale plan and comes back after a normal thinking pause.
        clearTask(room, bot, now, 1800);
      }
      break;
    }
  });
}

export async function botTick(now = Date.now()) {
  let created = 0, moved = 0;
  for (let index = 0; index < SLOTS.length; index++) {
    const slot = SLOTS[index];
    if (await ensureRoom(slot, index, now)) created++;
    const active = await activeRoomFor(slot);
    if (!active) continue;
    try { await playOne(active.id, now); moved++; } catch { /* a transient room write is retried by the next tick */ }
  }
  return { created, rooms: SLOTS.length, moved };
}
