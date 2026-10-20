// Run with: npm test
// The Nobel shelf's refresh: the missing laureates are taken NEWEST first (never in the source's own order), and the shelf stays latest to oldest
// so a new year is always added at the front. Years already on the shelf are never looked up again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nobelMissing, nobelOrder } from './dynamic';

type Seed = [string, string, string?];
const label = (y: number) => `Nobel Prize in Literature ${y}`;
const laureate = (year: number) => ({ year, name: `Author ${year}` });

test('missing laureates are taken newest first even when the source lists oldest first', () => {
  const oldestFirst = [1990, 1995, 2000, 2005, 2010, 2015, 2020, 2024].map(laureate);
  assert.deepEqual(nobelMissing(oldestFirst, new Set(), 2026).map(l => l.year), [2024, 2020, 2015, 2010]);
  const shuffled = [2005, 2024, 1990, 2020, 2010].map(laureate);
  assert.deepEqual(nobelMissing(shuffled, new Set(), 2026, 3).map(l => l.year), [2024, 2020, 2010]);
});

test('years already on the shelf are skipped (never looked up again) and so is a year that has not happened yet', () => {
  const all = [2027, 2026, 2025, 2024, 2023].map(laureate);
  assert.deepEqual(nobelMissing(all, new Set([2024, 2023]), 2026).map(l => l.year), [2026, 2025]);
  assert.deepEqual(nobelMissing(all, new Set([2026, 2025, 2024, 2023]), 2026), []);
});

test('the shelf is ordered latest to oldest: a new year goes in front, older winners stay', () => {
  const shelf: Seed[] = [['Book 2022', 'A', label(2022)], ['Book 2024', 'B', label(2024)], ['Book 2023', 'C', label(2023)]]; // an old hand-picked order
  const added: Seed[] = [['Book 2025', 'D', label(2025)]];
  const out = nobelOrder([...added, ...shelf]);
  assert.deepEqual(out.map(s => s[2]), [label(2025), label(2024), label(2023), label(2022)]);
  assert.equal(out.length, 4, 'nothing is dropped');
  assert.deepEqual(nobelOrder(out), out, 'already ordered: unchanged');
});

test('a seed without a year goes after the dated ones, and equal years keep their order', () => {
  const seeds: Seed[] = [['No year', 'X', 'Hand picked'], ['Two B', 'B', label(2020)], ['Two A', 'A', label(2020)], ['New', 'N', label(2025)], ['Bare', 'Y']];
  assert.deepEqual(nobelOrder(seeds).map(s => s[0]), ['New', 'Two B', 'Two A', 'No year', 'Bare']);
});

test('a refresh with an oldest-first source puts the newest missing year first and keeps the rest of the shelf', () => {
  const shelf: Seed[] = [2023, 2022, 2021].map(y => [`Book ${y}`, `Author ${y}`, label(y)] as Seed);
  const have = new Set(shelf.map(s => Number(String(s[2]).slice(-4))));
  const source = [1980, 1990, 2000, 2021, 2022, 2023, 2024].map(laureate); // oldest first
  const todo = nobelMissing(source, have, 2026);
  assert.deepEqual(todo.map(l => l.year), [2024, 2000, 1990, 1980]);
  const added: Seed[] = todo.map(l => [`Book ${l.year}`, l.name, label(l.year)]);
  const years = nobelOrder([...added, ...shelf]).map(s => Number(String(s[2]).slice(-4)));
  assert.deepEqual(years, [2024, 2023, 2022, 2021, 2000, 1990, 1980]);
});

// The real refresh path: a shelf saved in the WRONG order (older winners in front, 2026 in the middle, as one device showed) is put right
import { refreshShelf, DYNAMIC_SPECS } from './dynamic';
import { CURATED_SHELVES } from '../../data/storeCatalog';

test('refreshShelf puts a wrongly ordered saved shelf latest to oldest, with the new year in front (keepExisting no longer freezes a bad order)', async () => {
  const base = CURATED_SHELVES.find(s => s.id === 'nobel')!;
  const wrong: Seed[] = [['Old C', 'A3', label(2017)], ['Old B', 'A2', label(2018)], ['Old A', 'A1', label(2019)], ['Mid', 'M', label(2026)], ['Eleven', 'E', label(2025)], ['Ten', 'T', label(2024)]];
  const shelf = { ...base, id: 'nobel-order-test', seeds: wrong };
  const fresh: Seed[] = [['Newest', 'N', label(2027)], ['Mid', 'M', label(2026)], ['Eleven', 'E', label(2025)], ['Ten', 'T', label(2024)], ['Old A', 'A1', label(2019)]];
  const spec = { ...DYNAMIC_SPECS.nobel, fetch: async () => ({ seeds: fresh }) };
  const saved = await refreshShelf(shelf, spec);
  assert.ok(saved);
  const years = saved!.seeds.map(s => Number(String(s[2]).slice(-4)));
  assert.deepEqual(years, [2027, 2026, 2025, 2024, 2019, 2018, 2017]);
  assert.equal(saved!.seeds.filter(s => s[0] === 'Mid').length, 1, 'no duplicates');
  assert.equal(spec.order, DYNAMIC_SPECS.nobel.order, 'the Nobel spec orders its shelf');
});
