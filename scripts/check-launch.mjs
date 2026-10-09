import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const root=new URL('../',import.meta.url),checks=[];
const check=(name,ok,detail)=>checks.push({name,status:ok?'pass':'pending',detail});
let settings={},evidence={};
try{settings=parseEnv(await readFile(new URL('.env.beta',root),'utf8'));}catch{}
try{evidence=JSON.parse(await readFile(new URL('work/launch-evidence.json',root),'utf8'));}catch{}
let originValid=false;try{const origin=new URL(settings.PUZZLE_PUBLIC_ORIGIN);originValid=origin.protocol==='https:'&&origin.origin===settings.PUZZLE_PUBLIC_ORIGIN&&!origin.username&&!origin.password&&!/localhost|127\.0\.0\.1/.test(origin.hostname);}catch{}
check('HTTPS domain configured',originValid,'Runtime origin must match the final HTTPS domain.');
check('Operator identified',!!settings.PUZZLE_OPERATOR_NAME?.trim(),'Do not invent an operator name.');
check('Support email configured',/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.PUZZLE_SUPPORT_EMAIL||''),'A working, monitored inbox is required.');
check('Explicit administrator account',/^[a-f0-9]{32}(\s*,\s*[a-f0-9]{32})*$/.test(settings.PUZZLE_ADMIN_IDS||''),'Use existing account IDs. No automatic administrator.');
check('Limited admission configured',/^(?:[1-9]\d?|1\d\d|200)$/.test(settings.PUZZLE_BETA_CAPACITY||''),'Select a tested capacity between 1 and 200.');
for(const key of ['productionDeploymentVerified','trustedIngressAndRateLimitsVerified','offsiteBackupAndRestoreVerified','uptimeAlertsAndRollbackVerified','targetCapacityAndBudgetVerified','overseasNetworkVerified','safariIosAndroidVerified','supportServiceVerified','administratorAccessReviewed','operatorPrivacyAndTermsReviewed','assetRightsReviewed'])check(key,evidence[key]===true,'Needs actual evidence; local builds are not substitutes.');
const report={checkedAt:new Date().toISOString(),ready:checks.every(c=>c.status==='pass'),checks,scope:'Free limited beta only. Payments and advertising remain disabled. This checklist does not deploy or certify compliance.'};
await mkdir(new URL('work/launch/',root),{recursive:true});await writeFile(new URL('work/launch/readiness.json',root),JSON.stringify(report,null,2));
for(const row of checks)console.log(`[${row.status}] ${row.name}`);
console.log(report.ready?'Recorded launch prerequisites complete.':'Not ready for public launch: external prerequisites remain.');
if(!report.ready)process.exitCode=2;
