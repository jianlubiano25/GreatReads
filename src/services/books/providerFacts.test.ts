import test from "node:test";
import assert from "node:assert/strict";

import { persistable } from './providerFacts';
test('what is kept on the device stays inside a small budget, newest first, and only the newest keep their long texts', () => {
  const mk = (i: number) => ({ provider: 'hardcover' as const, recordId: String(i), genres: ['Fantasy'], description: 'd'.repeat(2000), authorBio: 'b'.repeat(2000), seenAt: 'x' });
  const all = Array.from({ length: 300 }, (_, i) => mk(i));
  const kept = persistable(all);
  assert.ok(JSON.stringify(kept).length <= 300_000, 'inside the budget');
  assert.equal(kept[kept.length - 1].recordId, '299', 'the newest is kept');
  assert.ok(kept[kept.length - 1].description, 'a recent one keeps its text');
  assert.equal(kept[0].description, undefined, 'an old one keeps labels only');
  assert.ok(kept.length > 40);
  assert.ok(persistable(all, 5_000).length < 10, 'a tiny budget keeps only a few');
});
