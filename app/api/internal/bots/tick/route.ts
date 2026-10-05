import { botTick } from '@/lib/bot-runner';

function botSecret() { return (typeof process !== 'undefined' && process.env?.PUZZLE_BOT_SECRET) || 'local-preview-bot-secret'; }

export async function POST(request: Request) {
  if (request.headers.get('x-puzzle-bot-secret') !== botSecret()) return Response.json({ error: 'Not found' }, { status: 404 });
  try { return Response.json(await botTick(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Bot tick failed' }, { status: 503 }); }
}
