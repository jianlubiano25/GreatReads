// Run with: npx tsx --test src/services/store/genre-pool-queries.test.ts
// C17: weak genres (Sports, Humor, Children's, Manga) build their pool from precise queries and have a strong hand-picked row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_GENRES } from '../../data/searchGenres';
import { addPoolQueries } from './genreRows';
import { genreForQuery } from '../books/genreRank';

const g = (label: string) => SEARCH_GENRES.find(x => x.label.startsWith(label))!;
const bk = (id: string) => ({ id, title: id, author: 'A' }) as any;

test('the four weak genres use precise pool queries and a strong picks row', () => {
  for (const [label, min] of [['Sports', 15], ['Humor', 0], ['Children', 20], ['Manga', 20]] as const) {
    const x = g(label);
    assert.ok((x.poolQueries?.length ?? 0) >= 3, `${label}: poolQueries`);
    assert.ok(x.poolQueries!.every(q => q.trim().length > 3 && q.trim() !== x.query), `${label}: each pool query is more precise than the typed word`);
    assert.ok((x.picks?.length ?? 0) >= min, `${label}: picks`);
    assert.equal(new Set((x.picks ?? []).map(p => p.join('|'))).size, (x.picks ?? []).length, `${label}: no duplicate pick`);
  }
  assert.equal(g('Sports').kind, 'nonfiction');
});

test('typed words still open the right genre: the genre word, its aliases and the sport words', () => {
  for (const [typed, label] of [['sports', 'Sports'], ['football', 'Sports'], ['humor', 'Humor'], ['comedy', 'Humor'], ['children\'s books', 'Children'], ['manga', 'Manga']] as const)
    assert.ok(genreForQuery(typed)?.genre.label.startsWith(label), typed);
});

test('addPoolQueries adds the other queries\' books once each, skips the first query, and survives a failing search', async () => {
  const asked: string[] = [];
  const out = await addPoolQueries(g('Humor'), [bk('a'), bk('b')], async q => { asked.push(q); if (q === 'comedian memoir') throw new Error('down'); return [bk('b'), bk(`${q}-1`)]; });
  assert.deepEqual(asked, ['comedian memoir', 'satire'], 'the first query is the pool\'s own search');
  assert.deepEqual(out.map(b => b.id), ['a', 'b', 'satire-1']);
  const none = await addPoolQueries({ ...g('Cozy') }, [bk('a')], async () => { throw new Error('never asked'); });
  assert.deepEqual(none.map(b => b.id), ['a'], 'a genre without poolQueries is unchanged');
});
