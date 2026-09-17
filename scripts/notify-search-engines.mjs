import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { isPublishedPlayable } from './image-origin.mjs';

const ORIGIN = 'https://jigsawnook.online';
const root = fileURLToPath(new URL('..', import.meta.url));
export function publicUrls(catalog) {
  const paths = ['/', '/lobby', '/gallery', '/help'];
  for (const photo of catalog) {
    if (!isPublishedPlayable(photo)) continue;
    assert.match(photo.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    paths.push('/puzzle/' + photo.id);
  }
  return [...new Set(paths)].map(path => ORIGIN + path);
}
export function selectUrls(catalog, requested = []) {
  const allowed = new Set(publicUrls(catalog));
  const selected = requested.length ? [...new Set(requested)] : [...allowed];
  for (const url of selected) assert.ok(allowed.has(url), 'Only canonical public pages may be submitted: ' + url);
  assert.ok(selected.length > 0 && selected.length <= 10000);
  return selected.sort();
}
async function main() {
  const args = process.argv.slice(2);
  for (const arg of args.filter(arg => arg.startsWith('--'))) assert.ok(['--submit', '--force'].includes(arg), 'Unknown option');
  const catalog = JSON.parse(readFileSync(resolve(root, 'content/puzzle-catalog.json'), 'utf8'));
  const urlList = selectUrls(catalog, args.filter(arg => !arg.startsWith('--')));
  if (!args.includes('--submit')) {
    console.log(JSON.stringify({ dryRun: true, endpoint: 'https://api.indexnow.org/indexnow', urls: urlList }, null, 2));
    return;
  }
  const config = JSON.parse(readFileSync(resolve(root, 'config/search-engines.json'), 'utf8'));
  assert.match(config.indexNowKeyFile, /^\/[a-f0-9]{32}\.txt$/);
  const key = readFileSync(resolve(root, 'public' + config.indexNowKeyFile), 'utf8').trim();
  assert.equal(config.indexNowKeyFile, '/' + key + '.txt');
  const keyLocation = ORIGIN + config.indexNowKeyFile;
  const get = url => fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const keyResponse = await get(keyLocation);
  assert.equal(keyResponse.status, 200, 'Deploy and verify the key file before submitting');
  assert.equal((await keyResponse.text()).trim(), key);
  const sitemapResponse = await get(ORIGIN + '/sitemap.xml');
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  const liveUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual([...new Set(liveUrls)].sort(), publicUrls(catalog).sort(), 'Local and deployed catalog differ');
  for (const url of urlList) assert.ok(liveUrls.includes(url));
  const folder = resolve(root, 'work/indexnow');
  const log = resolve(folder, 'latest.json');
  const signature = createHash('sha256').update(JSON.stringify({ urlList, key })).digest('hex');
  if (!args.includes('--force') && existsSync(log)) {
    const previous = JSON.parse(readFileSync(log, 'utf8'));
    if (previous.signature === signature && [200, 202].includes(previous.status)) {
      console.log('This URL batch was already received. Submit specific changed URLs, or use --force after a real content update.');
      return;
    }
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
  mkdirSync(folder, { recursive: true });
  writeFileSync(log, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  assert.ok([200, 202].includes(response.status), 'Submission failed; respect Retry-After before retrying');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
