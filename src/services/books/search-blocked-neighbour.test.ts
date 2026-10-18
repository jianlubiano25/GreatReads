import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };

const camusOL = { key: '/works/OL1W', title: 'The Stranger', author_name: ['Albert Camus'], first_publish_year: 1942, cover_i: 1, ratings_average: 4.0, ratings_count: 900, subject: ['Fiction', 'Classics'] };
const gItem = (id: string, title: string, authors: string[] | undefined, cats: string[], desc = '') => ({ id, volumeInfo: { title, authors, categories: cats, description: desc, publishedDate: '2012', averageRating: 4, ratingsCount: 50 } });
const routes = (url: string) => {
  if (url.includes('openlibrary.org/search.json')) return { numFound: 1, docs: [camusOL] };
  if (url.includes('googleapis.com/books')) return { totalItems: 2, items: [
    gItem('a', 'The Stranger', ['Albert Camus'], ['Fiction / Classics']),
    gItem('b', 'The Stranger', undefined, ['Fiction / Erotica'], 'steamy romance'),
  ] };
  return null;
};
(globalThis as any).fetch = async (url: string) => { const d = routes(String(url)); return { ok: !!d, status: d ? 200 : 404, json: async () => d } as any; };
const { searchBooksLive } = await import('./search');

test('The Stranger by Albert Camus is found even when another, blocked "The Stranger" exists', async () => {
  const r = await searchBooksLive('the stranger by albert camus', { final: true, local: false });

  assert.ok(r.some(b => b.author === 'Albert Camus'));
});

test('the blocked one itself stays out', async () => {
  const r = await searchBooksLive('the stranger by albert camus', { final: true, local: false });
  assert.ok(!r.some(b => /Unknown/i.test(b.author) && b.title === 'The Stranger'));
});
