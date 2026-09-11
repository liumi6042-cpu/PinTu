export function retryDelay(value: string | null, now = Date.now()) {
  const seconds = value !== null && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : value ? Date.parse(value) - now : 1000;
  return Math.max(1000, Math.min(60000, Number.isFinite(milliseconds) ? milliseconds : 1000));
}
