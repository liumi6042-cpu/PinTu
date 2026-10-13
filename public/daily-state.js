const DAY = 86400000, OFFSET = 8 * 3600000;
export const beijingDate = (now = Date.now()) => new Date(now + OFFSET).toISOString().slice(0, 10);
export const tomorrowDate = (now = Date.now()) => beijingDate(now + DAY);
export const automaticDailyPlan = plan => plan?.autoPublish === true || plan?.autoDate === true;

export function nextOpenDailyDate(plans = [], {excludeId = '', now = Date.now()} = {}) {
  const occupied = new Set(plans.filter(plan => plan.imageId !== excludeId && !automaticDailyPlan(plan)).map(plan => plan.date));
  for (let offset = 1; offset <= occupied.size + 1; offset++) {
    const candidate = beijingDate(now + offset * DAY);
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error('暂时无法安排每日日期。');
}

// Dates alone describe a plan. Appearance and collection badges require facts.
export function dailyImageState({imageId, plans = [], appearances = [], enrollments = [], isLegacy = false, today = beijingDate()}) {
  const plan = plans.find(item => item.imageId === imageId);
  const history = appearances.filter(item => item.imageId === imageId).sort((a,b) => a.date.localeCompare(b.date));
  const appearance = history.find(item => item.planned !== false && item.albumId) || history[0];
  const isToday = history.some(item => item.date === today);
  const enrollment = enrollments.find(item => item.imageId === imageId);
  const plannedAppearance = Boolean(appearance?.albumId && appearance.planned !== false);
  const locked = Boolean(plannedAppearance && plan && (automaticDailyPlan(plan) || appearance.date === plan.date));
  if (enrollment) return {code:'enrolled',label:'已收录',detail:`首次出场 ${enrollment.firstAppearanceDate} · 已自动收录`,plan,appearance,enrollment,locked:true};
  if (appearance) return {code:isToday?'today':plannedAppearance?'appeared':'library',label:isToday?'今日每日':plannedAppearance?'已出场 · 待收录':'曾为每日',detail:`首次出场 ${appearance.date} · ${plannedAppearance?'次日 00:00 自动收录':'从相册随机选中，保留原相册归属'}`,plan,appearance,locked};
  if (automaticDailyPlan(plan)) return {code:'automatic',label:'待自动发布',detail:'不预占日期；当天无指定首发时，从尚未发布的自动图片中随机选一张，出场次日自动收录。',plan,locked:false};
  if (plan) return {code:plan.date <= today?'awaiting':'scheduled',label:plan.date <= today?'待游戏确认':'指定日期',detail:`首发 ${plan.date} · 游戏确认出场后自动收录`,plan,locked:false};
  if (isLegacy) return {code:'legacy',label:'原每日图片',detail:'原来的三张每日轮换图之一；没有已确认的历史出场记录，可安排自动发布或指定日期。',locked:false};
  return {code:'none',label:'',detail:'',locked:false};
}
