import { localDb } from '@/lib/local-db';
import { readManagedContent } from '@/lib/managed-content';
export async function GET() {
  try {
    const content=readManagedContent();
    await localDb().prepare('SELECT 1 AS ready').first();
    return Response.json({ ok:true, status: 'ok', service: 'jigsaw-nook', contentReleaseId:content?.releaseId??null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok:false, status: 'unavailable', service:'jigsaw-nook', contentReleaseId:null }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
