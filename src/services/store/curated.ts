import type { Book } from '../../types';
import resolvedData from '../../data/storeResolved.json';
import type { CuratedShelf } from '../../data/storeCatalog';
import { mapPool } from '../books/http';
import { persistentCache } from '../books/cache';
import { workIdFromKey } from '../books/identity';
import { makeBook } from '../books/model';
import { getCoverUrl } from '../books/covers';
import { resolveBook } from '../books/resolve';
import type { ShelfSource } from './shelves';

/** Output of `npm run prefetch:store`: covers + combined ratings bundled with the app, matched to the seed list by position. */
const PREFETCHED = resolvedData as unknown as Record<string, (Partial<Book> & { olKey?: string } | null)[]>;

const SEED_COLORS = ['#6b6f80', '#8a5a3b', '#2e5934', '#925838', '#3a7d80', '#7a4a6a'];
const cache = persistentCache<{ sig: string; books: Book[] }>('readlife.curated1', { ttl: 7 * 24 * 60 * 60 * 1000, max: 40 });

/** Changes whenever the shelf's books or pick labels change, so an edited shelf never shows an old cached one. */
const shelfSig = (shelf: CuratedShelf) => shelf.seeds.map(s => `${s[0]}|${s[1]}|${s[2] || ''}`).join('~');

/** Title-only books so a shelf can draw right away, before any network call (plus whatever was prefetched at build time). */
export function seedPlaceholders(shelf: CuratedShelf): Book[] {
  return shelf.seeds.map(([t, a, award], i) => {
    const rec = PREFETCHED[shelf.id]?.[i] || {};
    // Prefetched data is matched by position, so ignore it if the shelf was edited and this slot now holds another book
    const r = !rec.title || rec.title === t ? rec : {};
    const olWork = r.olKey ? workIdFromKey(r.olKey) : undefined;
    return makeBook({
      id: r.olKey ? `ol_${r.olKey.replace(/\W/g, '_')}` : `seed_${shelf.id}_${i}`,
      awardLabel: award,
      title: t,
      author: a,
      genre: shelf.genre,
      summary: `${t} by ${a}.`,
      spineColor: SEED_COLORS[i % SEED_COLORS.length],
      source: 'openlibrary',
      coverId: r.coverId,
      coverUrl: r.coverUrl,
      ratingAverage: r.ratingAverage,
      ratingCount: r.ratingCount,
      year: r.year || '',
      pageCount: r.pageCount || 0,
      identity: olWork ? { olWork } : undefined,
    });
  });
}

export function getCachedCurated(shelf: CuratedShelf): Book[] | null {
  const hit = cache.get(shelf.id);
  return hit && hit.sig === shelfSig(shelf) && hit.books.length === shelf.seeds.length ? hit.books : null;
}

/** Looks up covers + ratings 4 at a time through the shared resolver, pushing each result to the shelf as it arrives. */
export async function resolveCuratedShelf(shelf: CuratedShelf, current: Book[], onUpdate: (b: Book[]) => void): Promise<void> {
  const out = [...current];
  await mapPool(shelf.seeds, 4, async ([title, author, award], i) => {
    if (out[i].coverId || out[i].coverUrl) return;
    const r = await resolveBook({ title, author, fallbackId: out[i].id, genreHint: shelf.genre });
    if (!r) return;
    out[i] = { ...r.book, title, author, genre: shelf.genre, awardLabel: award, year: r.book.year || out[i].year, spineColor: out[i].spineColor };
    try { new Image().src = getCoverUrl(r.book.coverId, 'M', r.book.coverUrl); } catch {} // warm the cache
    onUpdate([...out]);
  });
  if (out.filter(b => b.coverId || b.coverUrl).length >= Math.ceil(out.length / 2)) cache.set(shelf.id, { sig: shelfSig(shelf), books: out });
}

/** A curated shelf as a ShelfSource (used by the Store's generic shelf component). */
export function curatedSource(shelf: CuratedShelf): ShelfSource & { seeded: () => Book[] } {
  const seeded = () => {
    const s = seedPlaceholders(shelf);
    // Fully prefetched shelves need no lookups and no cache at all
    return s.every(b => b.coverId || b.coverUrl) ? s : getCachedCurated(shelf) || s;
  };
  return {
    id: shelf.id,
    seeded,
    cached: seeded,
    load: async onUpdate => {
      const start = seeded();
      await resolveCuratedShelf(shelf, start, onUpdate);
      return start;
    },
  };
}

