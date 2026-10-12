/**
 * Pre-fills the Store's covers, ratings, pages and years (src/data/storeResolved.json) so the shelves draw instantly.
 *
 *   npm run prefetch:store                         (needs internet)
 *   npm run prefetch:store -- --max-minutes=10     stops politely at the time limit; run it again to finish the rest
 *   npm run prefetch:store -- --redo-ratings       asks for every book again
 *
 * There are NO matching or rating rules in this file. Every book goes through the same resolver the app uses (resolveBook with Apple
 * Books, in src/services/books/resolve.ts): strict title + author matching on every site, Google editions, and the rating ladder
 * Apple -> Open Library -> Google. A Store card and the book info therefore agree. Optional: VITE_GOOGLE_BOOKS_API_KEY (or
 * GOOGLE_BOOKS_API_KEY) in the environment gives Google a higher quota.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBook } from '../src/services/books/resolve';
import { isCurrentRecord, toPrefetchedRecord, type PrefetchedRecord } from '../src/services/books/prefetchRecord';
import { perfSnapshot } from '../src/services/books/perf';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = path.join(root, 'src/data/storeSeeds.json');
const OUT = path.join(root, 'src/data/storeResolved.json');

const shelves: { id: string; title: string; seeds: [string, string][] }[] = JSON.parse(await fs.readFile(SEEDS, 'utf8'));
let out: Record<string, (PrefetchedRecord | null)[]> = {};
try { out = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch {}

const redoRatings = process.argv.includes('--redo-ratings');
const maxMinutes = Number((process.argv.find(a => a.startsWith('--max-minutes=')) || '').split('=')[1]) || 0;
const deadline = maxMinutes ? Date.now() + maxMinutes * 60_000 : Infinity;

console.log(`Resolving ${shelves.length} shelves through the app's resolver...`);
let waiting = 0; // books whose answer is not final because a site could not be reached: the next run asks again

for (const shelf of shelves) {
  if (Date.now() > deadline) { console.log('Stopped at the time limit; run again to finish the rest.'); break; }
  out[shelf.id] = out[shelf.id] || [];
  const tasks = shelf.seeds.map(([title, author], i) => async () => {
    if (!redoRatings && isCurrentRecord(out[shelf.id][i], title)) return; // saved by the current rules: kept
    const r = await resolveBook({ title, author, apple: true, allSources: true }); // allSources: Google's rating is looked for on every book, so the book info needs no Google request
    const rec = toPrefetchedRecord(title, r);
    if (!rec.rv) waiting++;
    out[shelf.id][i] = rec;
  });
  for (let i = 0; i < tasks.length; i += 4) await Promise.all(tasks.slice(i, i + 4).map(fn => fn())); // 4 books at a time
  await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n'); // saved after each shelf
  const count = out[shelf.id].filter(b => b && (b.coverUrl || b.coverId)).length;
  console.log(`✓ [${shelf.title}]: ${count}/${shelf.seeds.length} covers resolved`);
}

if (waiting) console.log(`\n${waiting} book(s) had a site that could not be reached (rate limit or offline): run the command again to settle them.`);
// Counts only (never the key or a URL): how many Google Books requests this run made, and how they failed by HTTP status
// (e.g. net.failed.www.googleapis.com.403 = key restricted / API not enabled, .429 = quota). Shown so "no Google ratings" can be told apart from "Google refused".
const googleCounters = Object.entries(perfSnapshot().counters).filter(([k]) => k === 'net.www.googleapis.com' || k.startsWith('google.') || k.startsWith('net.failed.www.googleapis.com'));
console.log('Google Books requests this run:', googleCounters.length ? JSON.stringify(Object.fromEntries(googleCounters)) : 'none');
console.log('\nSaved to src/data/storeResolved.json');
setTimeout(() => process.exit(0), 600); // the app's caches flush on a timer; nothing is saved from here
