/**
 * Verifies the NYT list names used by the Store (src/services/store/lists.ts) against the names the NYT Books API publishes.
 *
 *   NYT_API_KEY=your-key npm run check:nyt
 *
 * Needs internet and your NYT key (the same one the /api/nyt function uses). Nothing is saved or changed. Exits 1 when a list
 * name the Store asks for is not in the NYT's own names list.
 */
import { NYT_EXTRA_SHELVES, NYT_SHELVES } from '../src/services/store/lists';
import { checkNytLists } from '../src/services/store/nytListNames';

const key = process.env.NYT_API_KEY;
if (!key) { console.error('Set NYT_API_KEY first:  NYT_API_KEY=... npm run check:nyt'); process.exit(2); }

const res = await fetch(`https://api.nytimes.com/svc/books/v3/lists/names.json?api-key=${encodeURIComponent(key)}`);
if (!res.ok) { console.error(`NYT names.json answered ${res.status}`); process.exit(2); }
const names = (await res.json())?.results ?? [];
console.log(`The NYT publishes ${names.length} lists.\n`);

const { found, missing } = checkNytLists(names, [...NYT_SHELVES, ...NYT_EXTRA_SHELVES]);
for (const f of found) console.log(`OK  ${f.id.padEnd(26)} ${f.list.padEnd(36)} "${f.display}" (updated ${f.updated})`);
for (const m of missing) console.log(`!!  ${m.id.padEnd(26)} ${m.list.padEnd(36)} NOT a NYT list name${m.suggestions.length ? `. Similar: ${m.suggestions.join(', ')}` : ''}`);
process.exit(missing.length ? 1 : 0);
