// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

import { learnAuthorGroup, preferredAuthor, authorNames, sameAuthorByAlias, canJoinAuthors, unlinkAuthorGroup, clearAuthorAliases } from './authorAliases';
import { refreshNames } from './englishTitle';
import { authorKey } from './identity';
import { appleJacketAuthor, isDistinctiveTitle } from './sources/appleBooks';
import { routeFetch } from '../store/testkit';

const listing = (title: string, author: string, year: string, id = 1) => ({ trackId: id, trackName: title, artistName: author, languageCodesISO2A: ['EN'], artworkUrl100: 'https://is1-ssl.mzstatic.com/a/100x100bb.jpg', releaseDate: `${year}-05-01T07:00:00Z` });
const apple = (...results: any[]) => routeFetch([u => (u.hostname.includes('itunes.apple.com') ? { body: { results } } : undefined)]);
const same = (a: string, b: string) => sameAuthorByAlias(authorKey(a), authorKey(b));

test('a short or common title never links two authors (The Witch: McFadden vs Ndiaye)', async () => {
  clearAuthorAliases();
  assert.equal(isDistinctiveTitle('The Witch'), false);
  assert.equal(isDistinctiveTitle('Less'), false);
  assert.equal(isDistinctiveTitle('Gone'), false);
  assert.equal(isDistinctiveTitle('Nettle & Bone'), true);
  // Apple lists exactly one "The Witch", by someone else, in the same year: still not evidence
  apple(listing('The Witch', 'Marie Ndiaye', '2024'));
  assert.equal(await appleJacketAuthor('The Witch'), null);
  const changed = await refreshNames({ id: 'w1', title: 'The Witch', author: 'Freida McFadden', year: '2024' });
  assert.equal(changed, false);
  assert.equal(same('Freida McFadden', 'Marie Ndiaye'), false);
  assert.equal(preferredAuthor('Freida McFadden'), 'Freida McFadden');
  assert.deepEqual(authorNames('Freida McFadden'), []);
});

test('title-only Apple answers need both years, agreeing within a year', async () => {
  clearAuthorAliases();
  apple(listing('The Long Quiet River Home', 'Other Person', '2022'));
  await refreshNames({ id: 'y1', title: 'The Long Quiet River Home', author: 'Some Writer', year: '2010' }); // years disagree
  await refreshNames({ id: 'y2', title: 'The Long Quiet River Home', author: 'Some Writer Two' }); // no year saved
  assert.equal(same('Some Writer', 'Other Person'), false);
  assert.equal(same('Some Writer Two', 'Other Person'), false);
});

test('two different authors listed under one title are never linked', async () => {
  clearAuthorAliases();
  apple(listing('Where The Quiet Rivers Run', 'Author One', '2022', 1), listing('Where The Quiet Rivers Run', 'Author Two', '2022', 2));
  assert.equal(await appleJacketAuthor('Where The Quiet Rivers Run'), null);
  await refreshNames({ id: 'm1', title: 'Where The Quiet Rivers Run', author: 'Author Three', year: '2022' });
  assert.equal(same('Author Three', 'Author One'), false);
});

test('a legitimate pen name still groups when the evidence is solid (distinctive title, one author, same year)', async () => {
  clearAuthorAliases();
  apple(listing('Nettle & Bone', 'T. Kingfisher', '2022'));
  const changed = await refreshNames({ id: 'k1', title: 'Nettle & Bone', author: 'Ursula Vernon', year: '2022' });
  assert.equal(changed, true);
  assert.equal(preferredAuthor('Ursula Vernon'), 'T. Kingfisher');
  assert.equal(same('Ursula Vernon', 'T. Kingfisher'), true);
  assert.deepEqual(authorNames('Ursula Vernon').slice(0, 2), ['T. Kingfisher', 'Ursula Vernon']);
});

test('a name that already belongs to another alias group is not joined by one lookup', async () => {
  clearAuthorAliases();
  learnAuthorGroup(['Alpha One', 'Alpha Pen'], { name: 'Alpha Pen', rank: 3 });
  assert.equal(canJoinAuthors('Alpha One', 'Beta Two'), false);
  assert.equal(canJoinAuthors('Alpha One', 'Alpha Pen'), true);
  assert.equal(canJoinAuthors('Gamma Three', 'Beta Two'), true);
  apple(listing('The Slow Silver Lantern Road', 'Beta Two', '2023'));
  await refreshNames({ id: 'c1', title: 'The Slow Silver Lantern Road', author: 'Alpha One', year: '2023' });
  assert.equal(same('Alpha One', 'Beta Two'), false);
  assert.equal(preferredAuthor('Alpha One'), 'Alpha Pen');
});

test('a group is never grown into a chain of many people, and a bad group can be unlinked', () => {
  clearAuthorAliases();
  learnAuthorGroup(['Ann A', 'Ben B', 'Cal C', 'Dee D', 'Eve E', 'Fay F']);
  learnAuthorGroup(['Fay F', 'Gus G']); // a seventh name: refused
  assert.equal(same('Fay F', 'Gus G'), false);
  learnAuthorGroup(['Freida McFadden', 'Marie Ndiaye'], { name: 'Marie Ndiaye', rank: 3 }); // a wrong link, as an old version could have made
  assert.equal(preferredAuthor('Freida McFadden'), 'Marie Ndiaye');
  assert.equal(unlinkAuthorGroup('Freida McFadden'), true);
  assert.equal(preferredAuthor('Freida McFadden'), 'Freida McFadden');
  assert.equal(same('Freida McFadden', 'Marie Ndiaye'), false);
  assert.equal(unlinkAuthorGroup('Freida McFadden'), false);
});
