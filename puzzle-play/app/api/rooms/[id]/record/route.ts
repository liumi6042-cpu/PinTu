// Compatibility response for game tabs opened before the leaderboard was removed.
// It deliberately performs no room read and writes no result.
export async function GET(){return Response.json({kind:'observer'},{headers:{'Cache-Control':'no-store'}});}
