// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksEnglish } from './language';
import { englishEditionQueries } from './identity';
import { gbItemToHit } from './sources/googleBooks';

const SV = 'Antligen på svenska! Dungeon Crawler Carl är en av de mest populära serierna just nu. Carl och hans katt Prinsessan Donut kämpar för att överleva i ett dödligt underjordiskt fängelse där hela mänskligheten är med i en tv-sändning som ingen kan stänga av.';
const EN = 'Carl is a former coal miner who gets dragged into a deadly dungeon after the world ends. With his cat, Princess Donut, he must fight to survive as an alien audience watches and bets on his every move.';

test('long prose in a language the word list does not know (Swedish) is not English; English still is', () => {
  assert.equal(looksEnglish(SV), false);
  assert.equal(looksEnglish(EN), true);
});

test('a Google volume in another language gives no blurb, an English one does', () => {
  const vol = (language: string, description: string) => ({ id: 'x', volumeInfo: { title: 'Carl’s Doomsday Scenario', authors: ['Matt Dinniman'], description, language } });
  assert.match(gbItemToHit(vol('sv', SV)).book.summary, /^A book by /);
  assert.equal(gbItemToHit(vol('sv', SV)).flags.description, undefined);
  assert.equal(gbItemToHit(vol('en', EN)).flags.description, EN);
});

test('the original title of a translated book also asks for its English edition', () => {
  assert.deepEqual(englishEditionQueries('L’Étranger'), ['The Stranger Albert Camus', 'The Outsider Albert Camus']);
  assert.deepEqual(englishEditionQueries('Dune'), []);
});
