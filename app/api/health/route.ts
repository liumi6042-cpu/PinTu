import { localDb } from '@/lib/local-db';
export async function GET() {
  try {
    await localDb().prepare('SELECT 1 AS ready').first();
    return Response.json({ status: 'ok', service: 'jigsaw-nook' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
