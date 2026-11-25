// Draw from the full published collection, regardless of gallery filters.
export function randomPhoto<T>(photos: readonly T[], random = Math.random): T {
  if (!photos.length) throw new Error('图库暂时没有可用图片');
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机选择失败，请重试');
  return photos[Math.floor(value * photos.length)];
}
