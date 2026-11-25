import { env } from 'cloudflare:workers';

export function GET() {
  const origin = (env as unknown as { PUZZLE_LOCAL_ORIGIN?: string }).PUZZLE_LOCAL_ORIGIN;
  return Response.json({ app: 'together-puzzle', mode: origin ? 'local' : 'hosted', inviteOrigin: origin || null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
