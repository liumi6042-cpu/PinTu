import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRANCE_BYPASS, ENTRANCE_COOKIE, entrancePaths, isEntrancePath, languageRedirect, lobbyFor, skipsEntrance } from '../lib/entrance-preference.ts';
import { activeLanguage } from '../lib/site-paths.ts';
import { cookieLanguage, clearLanguageCookie, writeLanguageCookie, LANGUAGE_KEY } from '../lib/language-detection.ts';
import { getLanguagePreference, restoreLanguagePreference, setLanguagePreference } from '../lib/i18n.ts';

test('only a browser that has been in the lobby skips the entrance, and never a crawler', () => {
  for (const path of entrancePaths()) {
    assert.equal(skipsEntrance(path, false, '1'), true, path);
    // No cookie is what a crawler sends, and what a first-time visitor has.
    assert.equal(skipsEntrance(path, false, undefined), false, path);
    assert.equal(skipsEntrance(path, false, ''), false, path);
    assert.equal(skipsEntrance(path, false, '0'), false, path);
    // The brand link asks for the entrance on purpose.
    assert.equal(skipsEntrance(path, true, '1'), false, path);
  }
  // Nothing else moves, the lobby included.
  for (const path of ['/lobby', '/zh/lobby', '/gallery', '/zh/gallery', '/puzzle/lake', '/help', '/account', '/room/x']) {
    assert.equal(skipsEntrance(path, false, '1'), false, path);
  }
  assert.deepEqual(entrancePaths(), ['/', '/zh']);
  // Only these two addresses may vary by the cookie, which is what the cache headers hang on.
  for (const path of entrancePaths()) assert.equal(isEntrancePath(path), true, path);
  for (const path of ['/lobby', '/gallery', '/puzzle/lake', '/zh/gallery', '/']) assert.equal(isEntrancePath(path), path === '/', 'isEntrancePath ' + path);
  assert.equal(lobbyFor('/'), '/lobby');
  assert.equal(lobbyFor('/zh'), '/zh/lobby');
  assert.equal(ENTRANCE_BYPASS, 'home');
  assert.match(ENTRANCE_COOKIE, /^[a-z][a-z-]*$/);
});

test('a chosen language moves the visitor to the matching address, and only then', () => {
  // Chinese chosen: every English address moves to its Chinese twin.
  assert.equal(languageRedirect('/', 'zh'), '/zh');
  assert.equal(languageRedirect('/lobby', 'zh'), '/zh/lobby');
  assert.equal(languageRedirect('/gallery', 'zh'), '/zh/gallery');
  assert.equal(languageRedirect('/help', 'zh'), '/zh/help');
  assert.equal(languageRedirect('/puzzle/warm-sienna-study-01', 'zh'), '/zh/puzzle/warm-sienna-study-01');
  // English chosen: Chinese addresses move back to the English ones.
  assert.equal(languageRedirect('/zh', 'en'), '/');
  assert.equal(languageRedirect('/zh/lobby', 'en'), '/lobby');
  assert.equal(languageRedirect('/zh/puzzle/warm-sienna-study-01', 'en'), '/puzzle/warm-sienna-study-01');
  // Already on the matching address nothing moves, so the redirect cannot loop.
  assert.equal(languageRedirect('/zh/lobby', 'zh'), null);
  assert.equal(languageRedirect('/lobby', 'en'), null);
  assert.equal(languageRedirect('/zh', 'zh'), null);
  assert.equal(languageRedirect('/', 'en'), null);
  // No choice at all — every crawler, every first-time visitor — means no redirect.
  for (const path of ['/', '/zh', '/lobby', '/zh/lobby', '/gallery', '/puzzle/lake']) {
    assert.equal(languageRedirect(path, null), null, path);
  }
  // Pages without a Chinese twin never move, whatever the choice is.
  for (const path of ['/personal', '/room/abc', '/membership', '/privacy', '/terms', '/achievements', '/admin']) {
    assert.equal(languageRedirect(path, 'zh'), null, path);
    assert.equal(languageRedirect(path, 'en'), null, path);
  }
});

test('the switch lights the button that matches the page, and follows the choice elsewhere', () => {
  // Paired addresses: the address itself decides, whatever the visitor once chose.
  assert.equal(activeLanguage('/lobby', 'zh'), 'en');
  assert.equal(activeLanguage('/zh/lobby', 'en'), 'zh');
  assert.equal(activeLanguage('/', 'zh'), 'en');
  assert.equal(activeLanguage('/zh', 'en'), 'zh');
  assert.equal(activeLanguage('/gallery', 'zh'), 'en');
  assert.equal(activeLanguage('/zh/gallery', 'zh'), 'zh');
  assert.equal(activeLanguage('/puzzle/lake', 'zh'), 'en');
  assert.equal(activeLanguage('/zh/puzzle/lake', 'en'), 'zh');
  for (const preference of ['zh', 'en', 'auto']) {
    assert.equal(activeLanguage('/lobby', preference), 'en');
    assert.equal(activeLanguage('/zh/gallery', preference), 'zh');
  }
  // Pages without a Chinese twin keep following the visitor's own choice.
  for (const path of ['/personal', '/room/abc', '/membership', '/privacy', '/terms', '/achievements']) {
    assert.equal(activeLanguage(path, 'zh'), 'zh', path);
    assert.equal(activeLanguage(path, 'en'), 'en', path);
    assert.equal(activeLanguage(path, 'auto'), 'auto', path);
  }
});

test('only zh and en count as a chosen language', () => {
  assert.equal(cookieLanguage('zh'), 'zh');
  assert.equal(cookieLanguage('en'), 'en');
  assert.equal(cookieLanguage('auto'), null);
  assert.equal(cookieLanguage('ZH'), null);
  assert.equal(cookieLanguage(''), null);
  assert.equal(cookieLanguage(undefined), null);
});

test('an explicit choice writes the cookie the middleware reads, and auto clears it', () => {
  const originalDocument = globalThis.document, originalStorage = globalThis.localStorage;
  try {
    let cookie = '';
    globalThis.document = { documentElement: { lang: '' }, get cookie() { return cookie; }, set cookie(value) { cookie = String(value); } };
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    writeLanguageCookie('zh');
    assert.match(cookie, /^puzzle-language=zh; path=\/; max-age=\d+; SameSite=Lax$/);
    clearLanguageCookie();
    assert.match(cookie, /^puzzle-language=; path=\/; max-age=0; SameSite=Lax$/);
    // Choosing a language through the store writes it too...
    setLanguagePreference('zh');
    assert.match(cookie, /^puzzle-language=zh;/);
    assert.equal(getLanguagePreference(), 'zh');
    // ...and auto hands the decision back, so the cookie has to go.
    setLanguagePreference('auto');
    assert.match(cookie, /^puzzle-language=;/);
    assert.equal(getLanguagePreference(), 'auto');
    // A visitor whose choice predates this cookie: the very first restore writes it, which is
    // how their old choice reaches the middleware and lands them on the right address.
    globalThis.localStorage = { getItem: key => (key === LANGUAGE_KEY ? 'zh' : null), setItem: () => {} };
    restoreLanguagePreference();
    assert.match(cookie, /^puzzle-language=zh;/);
    assert.equal(getLanguagePreference(), 'zh');
  } finally {
    setLanguagePreference('auto');
    globalThis.document = originalDocument;
    globalThis.localStorage = originalStorage;
  }
});
