const DAY = 86400000, OFFSET = 8 * 3600000;
export const beijingDate = (now = Date.now()) => new Date(now + OFFSET).toISOString().slice(0, 10);
export const tomorrowDate = (now = Date.now()) => beijingDate(now + DAY);

// Dates alone describe a plan. Appearance and collection badges require facts.
export function dailyImageState({imageId, plans = [], appearances = [], enrollments = [], isLegacy = false, today = beijingDate()}) {
  const plan = plans.find(item => item.imageId === imageId);
  const appearance = appearances.filter(item => item.imageId === imageId).sort((a,b) => a.date.localeCompare(b.date))[0];
  const enrollment = enrollments.find(item => item.imageId === imageId);
  const locked = Boolean(appearance && plan && appearance.date === plan.date);
  if (enrollment) return {code:'enrolled',label:'已收录',detail:`首次出场 ${enrollment.firstAppearanceDate} · 已自动收录`,plan,appearance,enrollment,locked:true};
  if (appearance) return {code:appearance.date === today?'today':'appeared',label:appearance.date === today?'今日每日':'已出场 · 待收录',detail:`首次出场 ${appearance.date} · 次日 00:00 自动收录`,plan,appearance,locked};
  if (plan) return {code:plan.date <= today?'awaiting':'scheduled',label:plan.date <= today?'待游戏确认':'已排期',detail:`首发 ${plan.date} · 游戏确认出场后自动收录`,plan,locked:false};
  if (isLegacy) return {code:'legacy',label:'每日 · 待排期',detail:'旧每日图尚无可信首发记录，可安排首发日期与收录相册。',locked:false};
  return {code:'none',label:'',detail:'',locked:false};
}
