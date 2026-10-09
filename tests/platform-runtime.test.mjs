import test from 'node:test';
import assert from 'node:assert/strict';
import { canGrantReward, makeRewardRequest, validRewardRequestId } from '../lib/platform-reward.ts';
import { detectPlatform, runtimeFromBridge } from '../lib/platform-runtime.ts';

test('platform detection keeps ordinary web pages separate from TapTap H5', () => {
  assert.deepEqual(detectPlatform(''), { kind: 'web', isEmbedded: false, hasAuth: false, hasRewardedAd: false });
  assert.deepEqual(detectPlatform('?platform=taptap-h5'), { kind: 'taptap-h5', isEmbedded: true, hasAuth: false, hasRewardedAd: false });
  const bridge = { getCredential: async () => 'credential', showRewardedAd: async () => ({ completed: true }) };
  assert.deepEqual(runtimeFromBridge('taptap-h5', bridge), { kind: 'taptap-h5', isEmbedded: true, hasAuth: true, hasRewardedAd: true });
  assert.deepEqual(detectPlatform('', bridge), { kind: 'taptap-h5', isEmbedded: true, hasAuth: true, hasRewardedAd: true });
});

test('reward requests are short-lived, completed-only, and idempotent', () => {
  assert.equal(validRewardRequestId('reward-123456'), true);
  assert.equal(validRewardRequestId('short'), false);
  const request = makeRewardRequest('extra-hint', 'reward-123456', 1000);
  assert.equal(canGrantReward(request, false, new Set(), 2000), false);
  assert.equal(canGrantReward(request, true, new Set(), 2000), true);
  assert.equal(canGrantReward(request, true, new Set(['reward-123456']), 2000), false);
  assert.equal(canGrantReward(request, true, new Set(), 1000 + 10 * 60 * 1000 + 1), false);
});
