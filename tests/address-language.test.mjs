import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { addressCopy } from '../lib/address-language.ts';
import { englishFor, setLanguage } from '../lib/i18n.ts';
import { PHOTOS } from '../lib/puzzle-catalog.ts';

// The lobby once showed Chinese body copy with an English resume card and an English day's
// picture on it, because half the components followed the address and half followed the
// visitor's browser. A paired address now decides its own language in both directions.
test('a paired address decides its own language, whichever language the visitor reads', () => {
  // Wording lives in en.json and in the extras table, so the invariant asserted here is that the
  // English address resolves to English and the Chinese one returns the source untouched.
  const asEnglish = (path, text) => {
    const out = addressCopy(path, text);
    assert.notEqual(out, text, text);
    assert.ok(!/[\u4e00-\u9fff]/.test(out), out);
    return out;
  };
  try {
    setLanguage('zh');
    for (const text of ['公开拼图大厅', '公开房间免费，500 片及以上首次入座需要登录。', '把喜欢的画面，慢慢拼起来。']) {
      assert.equal(addressCopy('/zh/lobby', text), text);
      asEnglish('/lobby', text);
    }
    assert.equal(addressCopy('/zh', '把时光，'), '把时光，');
    assert.equal(addressCopy('/', '把时光，'), 'Make a moment');
    // Pictures are copy too: a gallery must not name them in the other language.
    for (const photo of PHOTOS) {
      assert.notEqual(addressCopy('/gallery', photo.title), photo.title, photo.id);
      assert.equal(addressCopy('/zh/gallery', photo.title), photo.title, photo.id);
      assert.notEqual(addressCopy('/gallery', photo.subtitle), photo.subtitle, photo.id);
    }

    setLanguage('en');
    assert.equal(addressCopy('/lobby', '公开拼图大厅'), 'Public puzzle lobby');
    assert.equal(addressCopy('/zh/lobby', '公开拼图大厅'), '公开拼图大厅');
  } finally {
    setLanguage('zh');
  }
});

// The legal pages, the personal space and a live room have no Chinese address, so forcing one
// there would push a Chinese visitor into English. They follow the interface language instead.
test('a page with no Chinese twin keeps following the visitor language', () => {
  try {
    setLanguage('zh');
    assert.equal(addressCopy('/personal', '个人空间'), '个人空间');
    assert.equal(addressCopy('/membership', '会员'), '会员');
    assert.equal(addressCopy('/room/abc', '继续拼图'), '继续拼图');
    setLanguage('en');
    assert.equal(addressCopy('/personal', '个人空间'), 'My space');
    assert.equal(addressCopy('/membership', '会员'), 'Membership');
  } finally {
    setLanguage('zh');
  }
});

test('non-strings pass through untouched', () => {
  assert.equal(addressCopy('/lobby', undefined), undefined);
  assert.deepEqual(addressCopy('/lobby', { a: 1 }), { a: 1 });
});

// A Chinese string handed to copy() without an English copy would print Chinese on the English
// address — the mirror image of the bug this module exists to prevent. The strings that only ever
// appear as inline `en ? English : 中文` pairs (the service footer labels) are not copy() input and
// are handled by their own components.
test('every Chinese string handed to copy() resolves to English', () => {
  const missing = new Set();
  for (const file of readdirSync('app').filter((name) => name.endsWith('.tsx'))) {
    const source = readFileSync('app/' + file, 'utf8');
    for (const call of source.matchAll(/(?<![A-Za-z0-9_$.])copy\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)) {
      for (const literal of call[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
        // The source may spell a character as an escape (\u2192 for →); look up the real string.
        const value = (literal[1] ?? literal[2])?.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        if (!value || !/[\u4e00-\u9fff]/.test(value)) continue;
        if (englishFor(value) === value) missing.add(file + ': ' + value);
      }
    }
  }
  assert.deepEqual([...missing], [], 'these copy() call sites have no English copy');
});
