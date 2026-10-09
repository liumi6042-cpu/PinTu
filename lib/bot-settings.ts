/**
 * Bots stay available for a later, more human-like pass, but are disabled in
 * the public site until that work is ready.
 */
export function botsEnabled() {
  return typeof process !== 'undefined' && process.env?.PUZZLE_BOTS_ENABLED === 'true';
}
