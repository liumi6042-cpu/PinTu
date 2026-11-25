import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { isPublishedPlayable } from './image-origin.mjs';

const ORIGIN = 'https://jigsawnook.online';
const BAIDU_ENDPOINT = 'http://data.zz.baidu.com/urls';
const root = fileURLToPath(new URL('..', import.meta.url));
export function publicUrls(catalog) {
  const paths = ['/', '/lobby', '/gallery', '/help'];
  for (const photo of catalog) {
    if (!isPublishedPlayable(photo)) continue;
    assert.match(photo.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    paths.push('/puzzle/' + photo.id);
  }
  // Every public page also exists in Chinese under /zh, and those pages are new to
  // search engines, so they are submitted alongside the English ones instead of
  // waiting for a crawler to stumble onto them.
  const unique = [...new Set(paths)];
  return [...unique, ...unique.map(path => '/zh' + (path === '/' ? '' : path))].map(path => ORIGIN + path);
}
export function selectUrls(catalog, requested = []) {
  const allowed = new Set(publicUrls(catalog));
  const selected = requested.length ? [...new Set(requested)] : [...allowed];
  for (const url of selected) assert.ok(allowed.has(url), 'Only canonical public pages may be submitted: ' + url);
  assert.ok(selected.length > 0 && selected.length <= 10000);
  return selected.sort();
}
function loggedBatch(folder, signature, accepted) {
  const log = resolve(root, folder, 'latest.json');
  if (!existsSync(log)) return false;
  const previous = JSON.parse(readFileSync(log, 'utf8'));
  return previous.signature === signature && accepted(previous);
}
function writeLog(folder, result) {
  mkdirSync(resolve(root, folder), { recursive: true });
  writeFileSync(resolve(root, folder, 'latest.json'), JSON.stringify(result, null, 2) + '\n');
}
async function submitIndexNow({ urlList, config, force }) {
  assert.match(config.indexNowKeyFile, /^\/[a-f0-9]{32}\.txt$/);
  const key = readFileSync(resolve(root, 'public' + config.indexNowKeyFile), 'utf8').trim();
  assert.equal(config.indexNowKeyFile, '/' + key + '.txt');
  const keyLocation = ORIGIN + config.indexNowKeyFile;
  const keyResponse = await fetch(keyLocation, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(keyResponse.status, 200, 'Deploy and verify the key file before submitting');
  assert.equal((await keyResponse.text()).trim(), key);
  const signature = createHash('sha256').update(JSON.stringify({ urlList, key })).digest('hex');
  if (!force && loggedBatch('work/indexnow', signature, previous => [200, 202].includes(previous.status))) {
    console.log('This URL batch was already received. Submit specific changed URLs, or use --force after a real content update.');
    return null;
  }
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: new URL(ORIGIN).hostname, key, keyLocation, urlList }),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const result = { at: new Date().toISOString(), endpoint: 'https://api.indexnow.org/indexnow', signature,
    status: response.status, retryAfter: response.headers.get('retry-after'), urls: urlList,
    meaning: response.status === 200 ? 'received, not proof of indexing' : response.status === 202 ? 'received; key validation pending' : 'not accepted' };
  await response.arrayBuffer();
  writeLog('work/indexnow', result);
  console.log(JSON.stringify(result, null, 2));
  assert.ok([200, 202].includes(response.status), 'Submission failed; respect Retry-After before retrying');
  return result;
}
// Baidu's 普通收录 answers with a small daily quota — this site's is ten URLs — so a
// larger batch is trimmed by Baidu and the rest waits for the next day. The response
// reports how many were taken, and that count is what the log keeps so a rerun of an
// identical batch does not quietly spend another day's quota.
export function baiduEndpoint(site, token) {
  assert.match(site, /^https:\/\/[a-z0-9.-]+$/, 'The Baidu site must be a bare https origin');
  // Baidu's endpoint is old enough that percent-encoding the site breaks it: it
  // answers "site init fail". The site is asserted above to be a bare origin, so
  // the separators can go through as written.
  return BAIDU_ENDPOINT + '?site=' + site + '&token=' + token;
}
async function submitBaidu({ urlList, config, force }) {
  assert.ok(config.baidu?.site && config.baidu?.token, 'Add the Baidu site and token to config/search-engines.json');
  const { site, token } = config.baidu;
  const endpoint = baiduEndpoint(site, token);
  const signature = createHash('sha256').update(JSON.stringify({ urlList, site })).digest('hex');
  if (!force && loggedBatch('work/baidu', signature, previous => (previous.accepted ?? 0) > 0)) {
    console.log('Baidu already took this batch. Use --force only after a real content update.');
    return null;
  }
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: urlList.join('\n'),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const accepted = payload?.success ?? 0, remaining = payload?.remain ?? null;
  const result = { at: new Date().toISOString(), endpoint: BAIDU_ENDPOINT, site, signature,
    status: response.status, submitted: urlList.length, accepted, quotaRemaining: remaining, urls: urlList,
    meaning: payload?.error ? 'rejected: ' + (payload.message ?? payload.error)
      : accepted === urlList.length ? 'received, not proof of indexing'
      : accepted > 0 ? 'daily quota reached; send the rest on a later day' : 'nothing accepted' };
  if (payload?.error !== undefined) result.error = payload.error;
  writeLog('work/baidu', result);
  console.log(JSON.stringify(result, null, 2));
  assert.ok(response.status === 200 && payload?.error === undefined, 'Baidu rejected the submission: ' + raw);
  assert.ok(accepted > 0 || remaining === 0, 'Baidu accepted none of the URLs while quota remained; check the site parameter');
  return result;
}
async function main() {
  const args = process.argv.slice(2);
  const options = args.filter(arg => arg.startsWith('--'));
  for (const option of options) assert.ok(['--submit', '--force', '--indexnow', '--baidu'].includes(option), 'Unknown option');
  // IndexNow stays the default so existing runs behave exactly as before. Baidu is
  // opt-in because every run spends part of a small daily quota.
  const channels = options.includes('--baidu') ? (options.includes('--indexnow') ? ['indexnow', 'baidu'] : ['baidu']) : ['indexnow'];
  const force = options.includes('--force');
  const catalog = JSON.parse(readFileSync(resolve(root, 'content/puzzle-catalog.json'), 'utf8'));
  const urlList = selectUrls(catalog, args.filter(arg => !arg.startsWith('--')));
  if (!options.includes('--submit')) {
    console.log(JSON.stringify({ dryRun: true, channels, urls: urlList }, null, 2));
    return;
  }
  const config = JSON.parse(readFileSync(resolve(root, 'config/search-engines.json'), 'utf8'));
  // Both channels are told about the same live addresses, so prove the deployed site
  // lists exactly what this checkout lists before spending anything on either.
  const sitemapResponse = await fetch(ORIGIN + '/sitemap.xml', { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(sitemapResponse.status, 200);
  const liveUrls = [...(await sitemapResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual([...new Set(liveUrls)].sort(), publicUrls(catalog).sort(), 'Local and deployed catalog differ');
  for (const url of urlList) assert.ok(liveUrls.includes(url));
  for (const channel of channels) {
    const submit = channel === 'baidu' ? submitBaidu : submitIndexNow;
    await submit({ urlList, config, force });
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
