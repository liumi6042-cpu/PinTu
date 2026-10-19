import { env } from 'cloudflare:workers';
import publicService from '@/config/public-service.json';

export type SiteSettings = {
  PUZZLE_LOCAL_ORIGIN?: string; PUZZLE_PUBLIC_ORIGIN?: string;
  PUZZLE_OPERATOR_NAME?: string; PUZZLE_SUPPORT_EMAIL?: string;
  PUZZLE_ADMIN_IDS?: string; PUZZLE_BETA_CAPACITY?: string;
  PUZZLE_FEEDBACK_ADMIN_URL?: string;
  PUZZLE_PRIVACY_REVIEWED?: string; PUZZLE_ASSETS_REVIEWED?: string;
  PUZZLE_REALTIME_ENABLED?: string;
  PUZZLE_DIAGNOSTIC_ACCOUNT_IDS?: string;
};
export function settings() { return env as unknown as SiteSettings; }
export function publicSettings() {
  const s=settings();
  return { operator:s.PUZZLE_OPERATOR_NAME?.trim()||publicService.operator, support:s.PUZZLE_SUPPORT_EMAIL?.trim()||publicService.support,
    local:!!s.PUZZLE_LOCAL_ORIGIN, capacity:betaCapacity(),
    policiesReviewed:s.PUZZLE_PRIVACY_REVIEWED==='true' };
}
export function betaCapacity() {
  const raw=settings().PUZZLE_BETA_CAPACITY;
  if(raw===undefined)return settings().PUZZLE_LOCAL_ORIGIN?0:24;
  const value=Number(raw);
  return Number.isInteger(value)&&value>=1&&value<=200?value:settings().PUZZLE_LOCAL_ORIGIN&&raw==='0'?0:24;
}
