import test from 'node:test';
import assert from 'node:assert/strict';
import { rootFromDefinition } from './dictionary';

test('a derived-form definition points at its root', () => {
  assert.equal(rootFromDefinition('queasiness', 'The state of being queasy.'), 'queasy');
  assert.equal(rootFromDefinition('queasiness', 'Being queasy'), 'queasy');
  assert.equal(rootFromDefinition('happiness', 'The quality of being happy'), 'happy');
});

test('ordinary definitions are left alone', () => {
  assert.equal(rootFromDefinition('serene', 'Calm, peaceful and untroubled.'), '');
  assert.equal(rootFromDefinition('hush', 'The state of being quiet and still, as in a library at night.'), '');
});

test('past tense, participles, plurals and adverbs point at their root', () => {
  assert.equal(rootFromDefinition('placated', 'simple past tense and past participle of placate.'), 'placate');
  assert.equal(rootFromDefinition('placated', 'simple past and past participle of placate'), 'placate');
  assert.equal(rootFromDefinition('placating', 'present participle of placate'), 'placate');
  assert.equal(rootFromDefinition('placates', 'third-person singular simple present indicative of placate'), 'placate');
  assert.equal(rootFromDefinition('mice', 'plural of mouse'), 'mouse');
  assert.equal(rootFromDefinition('queasily', 'In a queasy manner'), 'queasy');
  assert.equal(rootFromDefinition('bigger', 'comparative form of big'), 'big');
  assert.equal(rootFromDefinition('placate', 'To appease or pacify, as a person who is angry.'), '');
});

test('lookupWord adds the root meaning to a word-form, and a repeat search makes no request', async () => {
  const { lookupWord } = await import('./dictionary');
  const calls: string[] = [];
  const orig = globalThis.fetch;
  const entry = (word: string, definition: string) => [{ word, phonetic: `/${word}/`, meanings: [{ partOfSpeech: 'verb', definitions: [{ definition }] }] }];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const w = decodeURIComponent(String(url).split('/').pop() || '');
    const data = w === 'zzplacated' ? entry(w, 'simple past tense and past participle of zzplacate.') : w === 'zzplacate' ? entry(w, 'To appease or pacify.') : null;
    return { ok: !!data, json: async () => data } as Response;
  }) as typeof fetch;
  try {
    const r = await lookupWord('zzplacated');
    assert.match(r.definition, /past participle of zzplacate\. Zzplacate: To appease or pacify\./);
    const before = calls.length;
    const again = await lookupWord('zzplacated');
    assert.equal(again.definition, r.definition);
    assert.equal(calls.length, before, 'saved answers need no request');
  } finally {
    globalThis.fetch = orig;
  }
});
