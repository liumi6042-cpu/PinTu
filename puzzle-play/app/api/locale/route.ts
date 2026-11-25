import { settings } from '@/lib/site-settings';
import { localeResponse } from '@/lib/language-detection';

export function GET(request: Request) {
  return localeResponse(request, !!settings().PUZZLE_LOCAL_ORIGIN);
}
