export const ALBUM_FILTER_SCOPES = Object.freeze([
  { id: 'all', label: '全部', matches: () => true },
  { id: 'mobile', label: '小程序显示', matches: album => Boolean(album.showOnMobile) },
  { id: 'pc-only', label: '仅 PC', matches: album => Boolean(album.showOnPc && !album.showOnMobile) },
  { id: 'hidden', label: '两端隐藏', matches: album => !album.showOnPc && !album.showOnMobile },
  { id: 'purchasable', label: '购买包', matches: album => Boolean(album.purchasable) },
  { id: 'free', label: '免费', matches: album => !album.purchasable },
  { id: 'daily', label: '含每日', matches: (_album, ctx) => (ctx.dailyStats?.total ?? 0) > 0 },
]);

export function albumDailyStats(album, { dailyPlans = [], dailyStateFor } = {}) {
  const members = new Set(album?.imageIds || []);
  const plans = dailyPlans.filter(plan => plan.albumId === album.id || members.has(plan.imageId));
  if (!plans.length) return { total: 0, pending: 0 };
  let pending = 0;
  for (const plan of plans) {
    const code = dailyStateFor ? dailyStateFor(plan.imageId)?.code : 'automatic';
    if (['automatic', 'scheduled', 'awaiting'].includes(code)) pending++;
  }
  return { total: plans.length, pending };
}

export function filterAlbums(albums = [], { scope = 'all', query = '', dailyPlans = [], dailyStateFor, styleNameFor } = {}) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  const matcher = ALBUM_FILTER_SCOPES.find(item => item.id === scope)?.matches ?? ALBUM_FILTER_SCOPES[0].matches;
  return albums.filter(album => {
    const dailyStats = albumDailyStats(album, { dailyPlans, dailyStateFor });
    if (!matcher(album, { dailyStats })) return false;
    if (!needle) return true;
    const style = styleNameFor ? styleNameFor(album.styleGroupId) : '';
    return [album.title, album.description, album.id, style]
      .some(value => String(value || '').toLocaleLowerCase().includes(needle));
  });
}

export function countAlbumScopes(albums = [], { query = '', dailyPlans = [], dailyStateFor, styleNameFor } = {}) {
  const matchingQuery = filterAlbums(albums, { scope: 'all', query, dailyPlans, dailyStateFor, styleNameFor });
  const counts = {};
  for (const scope of ALBUM_FILTER_SCOPES) {
    counts[scope.id] = matchingQuery.filter(album => scope.matches(album, { dailyStats: albumDailyStats(album, { dailyPlans, dailyStateFor }) })).length;
  }
  return counts;
}
