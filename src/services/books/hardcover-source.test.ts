import test from 'node:test';
import assert from 'node:assert/strict';
import { hardcoverRating, resetHardcoverForTests } from './sources/hardcover';
import { withFallbackRatings } from '../store/genreRows';

const deps = (status: number, body: any, log: string[] = []) => ({ now: () => Date.now(), fetchJson: async (u: string) => { log.push(u); return { status, body }; } });

test('hardcoverRating: takes the same title (and author) with a rating and a count', async () => {
  resetHardcoverForTests();
  const body = { books: [{ title: 'Dune Messiah', authors: ['Frank Herbert'], rating: 3.9, ratingsCount: 100 }, { title: 'Dune', authors: ['Frank Herbert'], rating: 4.27, ratingsCount: 5000 }] };
  assert.deepEqual(await hardcoverRating('Dune', 'Frank Herbert', deps(200, body)), { average: 4.27, count: 5000 });
  assert.equal(await hardcoverRating('Dune', 'Someone Else', deps(200, body)), null, 'another author');
});

test('hardcoverRating: a missing key (503) switches it off for a while, so nothing is asked again', async () => {
  resetHardcoverForTests();
  const log: string[] = [];
  assert.equal(await hardcoverRating('Dune', 'F', deps(503, { error: 'not_configured' }, log)), null);
  assert.equal(await hardcoverRating('Emma', 'J', deps(200, { books: [] }, log)), null);
  assert.equal(log.length, 1);
  resetHardcoverForTests();
});

test('withFallbackRatings: Hardcover fills a gap first and is labelled hardcover; Open Library is the next try', async () => {
  const mk = (id: string, olWork?: string) => ({ id, title: id, author: 'A B', ...(olWork ? { identity: { olWork } } : {}) }) as any;
  const out = await withFallbackRatings([mk('x'), mk('y', 'OL1W'), mk('z', 'OL2W')], async w => (w === 'OL2W' ? { average: 4.1, count: 50 } : null), 10, async t => (t === 'x' || t === 'y' ? { average: 4.4, count: 300 } : null));
  assert.deepEqual(out.map(b => b.ratingSource), ['hardcover', 'hardcover', 'openlibrary']);
});

test('a Hardcover rating is shown as Hardcover (like Open Library / Apple / Google) when nothing else rated the book', async () => {
  const { mainRating, RATING_SOURCE_LABEL } = await import('./ratings');
  const main = mainRating({ id: 'h1', source: 'openlibrary', ratingAverage: 4.3, ratingCount: 120, ratingSource: 'hardcover' } as any, []);
  assert.equal(main?.source, 'hardcover');
  assert.equal(RATING_SOURCE_LABEL[main!.source as 'hardcover'], 'Hardcover');
});

test('a Hardcover match is remembered as a fourth provider record (id, link, readers, year, cover URL, rating) and found again by title + author', async () => {
  const { hardcoverMatch } = await import('./sources/hardcover');
  const { providerFactsFor, forgetProviderFactsForTests } = await import('./providerFacts');
  const { receiptRow, receiptKind } = await import('../catalogReceipts');
  resetHardcoverForTests(); forgetProviderFactsForTests();
  const body = { books: [{ id: 312460, slug: 'dune', title: 'Dune', authors: ['Frank Herbert'], rating: 4.27, ratingsCount: 5000, readers: 90000, year: 1965, cover: 'https://assets.hardcover.app/x.jpg', description: 'long text that must not be kept' }] };
  const hit = await hardcoverMatch('Dune', 'Frank Herbert', deps(200, body));
  assert.equal(hit?.id, '312460');
  const facts = providerFactsFor({ title: 'Dune', author: 'Frank Herbert' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].provider, 'hardcover');
  assert.deepEqual(facts[0].rating, { average: 4.27, count: 5000 });
  assert.equal(facts[0].sourceUrl, 'https://hardcover.app/books/dune');
  assert.equal(receiptKind('hardcover'), 'work');
  const row: any = receiptRow(facts[0], 'work-1');
  assert.equal(row.provider, 'hardcover');
  assert.equal(row.payload.extra.readers, 90000);
  assert.equal(row.payload.extra.cover, 'https://assets.hardcover.app/x.jpg');
  assert.ok(!JSON.stringify(row.payload).includes('long text'), 'the description text is never stored');
  assert.deepEqual(providerFactsFor({ title: 'Dune', author: 'Someone Else' }), []);
  forgetProviderFactsForTests();
});

test('hardcoverMatch remembers all of Hardcover\'s data (genres, pages, date, description, link, cover) as facts for the owner\'s candidates', async () => {
  const { hardcoverMatch } = await import('./sources/hardcover');
  const { providerFactsFor } = await import('./providerFacts');
  resetHardcoverForTests();
  const body = { books: [{ id: 7, slug: 'dune', title: 'Dune', authors: ['Frank Herbert'], rating: 4.27, ratingsCount: 5000, readers: 90000, year: 1965, releaseDate: '1965-08-01', pages: 412, genres: ['Science fiction', 'Classics'], cover: 'https://img.example/dune.jpg', description: 'Set on the desert planet Arrakis, Dune is the story of Paul Atreides.', subtitle: 'Book One' }] };
  await hardcoverMatch('Dune', 'Frank Herbert', deps(200, body));
  const f = providerFactsFor({ id: 'x', title: 'Dune', author: 'Frank Herbert' }).find(x => x.provider === 'hardcover')!;
  assert.deepEqual(f.genres, ['Science fiction', 'Classics']);
  assert.equal(f.pages, 412);
  assert.equal(f.publishedDate, '1965-08-01');
  assert.match(f.description || '', /Arrakis/);
  assert.equal(f.extra?.cover, 'https://img.example/dune.jpg');
  assert.equal(f.extra?.subtitle, 'Book One');
  assert.equal(f.sourceUrl, 'https://hardcover.app/books/dune');
  assert.equal(JSON.stringify((await import('../catalogReceipts')).receiptPayload(f)).includes('Arrakis'), false, 'the description is never in the receipt payload');
});

test('providerCandidateRows: Hardcover description and cover link become unpublished candidates with their source; nothing else does', async () => {
  const { providerCandidateRows } = await import('../catalogProviderCandidates');
  const hc: any = { provider: 'hardcover', recordId: '7', sourceUrl: 'https://hardcover.app/books/dune', description: 'Set on the desert planet Arrakis, Dune is the story of Paul Atreides.', extra: { cover: 'https://img.example/dune.jpg' }, seenAt: '2026-11-09' };
  const ap: any = { provider: 'apple', recordId: '9', genres: ['Fiction'], seenAt: '2026-11-09' };
  const rows = providerCandidateRows('w1', [hc, ap, { ...hc, recordId: '8', description: 'too short', extra: { cover: 'http://insecure/x.jpg' } }]);
  assert.deepEqual(rows.map(r => r.table), ['catalog_content_versions', 'catalog_cover_candidates']);
  assert.ok(rows.every(r => r.body.status === 'candidate' && r.body.source_name === 'hardcover' && r.body.source_record_id === '7'));
});

test('hardcoverAuthorBio: the author record\'s bio is attached to the book\'s Hardcover facts and saved as an unpublished author_bio candidate from Hardcover', async () => {
  const { hardcoverMatch, hardcoverAuthorBio } = await import('./sources/hardcover');
  const { providerFactsFor, forgetProviderFactsForTests } = await import('./providerFacts');
  const { providerCandidateRows } = await import('../catalogProviderCandidates');
  resetHardcoverForTests(); forgetProviderFactsForTests();
  await hardcoverMatch('Dune', 'Frank Herbert', deps(200, { books: [{ id: 312460, slug: 'dune', title: 'Dune', authors: ['Frank Herbert'], rating: 4.3, ratingsCount: 100 }] }));
  const bio = 'Frank Herbert was an American author best known for the science fiction novel Dune and its sequels.';
  assert.equal(await hardcoverAuthorBio('Dune', 'Frank Herbert', deps(200, { authors: [{ name: 'Frank Herbert', bio }] })), bio);
  const facts = providerFactsFor({ title: 'Dune', author: 'Frank Herbert' });
  const rows = providerCandidateRows('w1', facts).filter(r => r.body.content_type === 'author_bio');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].body.source_name, rows[0].body.status, rows[0].body.content], ['hardcover', 'candidate', bio]);
  assert.equal(await hardcoverAuthorBio('Dune', 'Frank Herbert', deps(200, { authors: [{ name: 'Someone Else', bio }] })), '', 'another author is not used');
  assert.equal(await hardcoverAuthorBio('Dune', 'Frank Herbert', deps(200, { authors: [{ name: 'Frank Herbert' }] })), '', 'no bio field: nothing');
  forgetProviderFactsForTests();
});
