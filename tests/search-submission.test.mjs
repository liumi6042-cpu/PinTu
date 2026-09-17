import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicUrls, selectUrls } from '../scripts/notify-search-engines.mjs';
const origin = 'https://jigsawnook.online';
const photo = (id, status = 'published', source = 'project-ai-generated') => ({ id, status, origin: source });

test('discovery excludes archived, draft and member-upload images', () => {
  const urls = publicUrls([photo('lake'), photo('old', 'archived'), photo('draft', 'draft'), photo('private', 'published', 'member-upload')]);
  assert.deepEqual(urls, ['/', '/lobby', '/gallery', '/help', '/puzzle/lake'].map(path => origin + path));
});
test('manual submission cannot leak rooms, credentials, queries or other domains', () => {
  for (const url of [origin + '/room/secret', origin + '/personal/images', origin + '/gallery?image=lake', origin + '/account', 'https://example.com/', origin + '/puzzle/unknown']) {
    assert.throws(() => selectUrls([photo('lake')], [url]));
  }
  assert.deepEqual(selectUrls([photo('lake')], [origin + '/puzzle/lake', origin + '/puzzle/lake']), [origin + '/puzzle/lake']);
});
test('initial submission covers all published public puzzle pages', () => {
  const catalog = JSON.parse(readFileSync(new URL('../content/puzzle-catalog.json', import.meta.url), 'utf8'));
  const urls = selectUrls(catalog);
  // Derive the expectation from the catalog instead of freezing a number that
  // silently goes stale each time a picture is published.
  const published = catalog.filter(photo => ['project-ai-generated', 'user-provided'].includes(photo.origin) && photo.status === 'published');
  const fixed = ['/', '/lobby', '/gallery', '/help'];
  assert.equal(urls.length, fixed.length + published.length);
  assert.equal(new Set(urls).size, urls.length);
  for (const photo of published) assert.ok(urls.includes(origin + '/puzzle/' + photo.id), photo.id);
  for (const path of fixed) assert.ok(urls.includes(origin + path), path);
});
