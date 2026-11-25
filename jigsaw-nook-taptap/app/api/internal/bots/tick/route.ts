import { botTick } from '@/lib/bot-runner';
import { botsEnabled } from '@/lib/bot-settings';

function botSecret() { return (typeof process !== 'undefined' && process.env?.PUZZLE_BOT_SECRET) || 'local-preview-bot-secret'; }

export async function POST(request: Request) {
  if (!botsEnabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  if (request.headers.get('x-puzzle-bot-secret') !== botSecret()) return Response.json({ error: 'Not found' }, { status: 404 });
  try { return Response.json(await botTick(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Bot tick failed' }, { status: 503 }); }
}
