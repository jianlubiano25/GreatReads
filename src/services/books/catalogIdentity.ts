/**
 * Which identifiers go where in the shared catalog, and what to do when they disagree. Pure rules, no network (catalog.ts does the reads and writes).
 *
 *  - WORK level (catalog_works.identifiers): only the Open Library work id (key `olWork`). A work is the book as a creation.
 *  - EDITION level (catalog_editions): ISBN-13, ISBN-10, Open Library edition id, Google Books volume id. An edition row is created only when at least
 *    one of these is known; a book with no ISBN or edition is still a normal catalog work (work_key identity).
 *  - Matching is by EXACT identifier only. Titles and authors are never used here.
 *  - Anything uncertain (an invalid ISBN, two ids that point to different editions, an id that already belongs to another work) is reported and
 *    NOT written. Nothing is ever moved, merged or overwritten.
 */
import type { BookIdentity } from '../../types';
import { isbn10to13, validIsbn } from './identity';

export type EditionIds = { isbn13?: string; isbn10?: string; olEdition?: string; gbVolume?: string };
export type CatalogIds = { olWork?: string } & EditionIds;

export function validIsbn13(raw = ''): string {
  const s = String(raw).replace(/[\s-]/g, '');
  return /^97[89]\d{10}$/.test(s) && validIsbn(s) ? s : ''; // the check digit is identity.validIsbn's, the only copy
}

export function validIsbn10(raw = ''): string {
  const s = String(raw).replace(/[\s-]/g, '').toUpperCase();
  return /^\d{9}[\dX]$/.test(s) && validIsbn(s) ? s : '';
}

/** Check what a book says about itself. Invalid or self-contradicting values are dropped and named in `rejected`; nothing is guessed or filled in. */
export function catalogIdsFrom(identity: BookIdentity | undefined): { ids: CatalogIds; rejected: string[] } {
  const ids: CatalogIds = {};
  const rejected: string[] = [];
  const src = identity || {};
  if (src.olWork) /^OL\d+W$/.test(src.olWork) ? (ids.olWork = src.olWork) : rejected.push('olWork');
  if (src.olEdition) /^OL\d+M$/.test(src.olEdition) ? (ids.olEdition = src.olEdition) : rejected.push('olEdition');
  if (src.gbVolume) /^[A-Za-z0-9_-]{6,24}$/.test(src.gbVolume) ? (ids.gbVolume = src.gbVolume) : rejected.push('gbVolume');
  const i13 = src.isbn13 ? validIsbn13(src.isbn13) : '';
  const i10 = src.isbn10 ? validIsbn10(src.isbn10) : '';
  if (src.isbn13 && !i13) rejected.push('isbn13');
  if (src.isbn10 && !i10) rejected.push('isbn10');
  if (i13 && i10 && isbn10to13(i10) !== i13) { rejected.push('isbn10/isbn13 disagree'); } // two different books' numbers: keep neither
  else { if (i13) ids.isbn13 = i13; if (i10) ids.isbn10 = i10; }
  return { ids, rejected };
}

export type WorkIdPlan = { patch?: { olWork: string }; conflicts: string[] };
/** The catalog work keeps whatever identifiers it has; olWork is added only when it has none. A different olWork is a conflict, never an overwrite. */
export function planWorkIdentifiers(existing: Record<string, unknown> | null | undefined, ids: CatalogIds): WorkIdPlan {
  if (!ids.olWork) return { conflicts: [] };
  const have = typeof existing?.olWork === 'string' ? existing.olWork : '';
  if (!have) return { patch: { olWork: ids.olWork }, conflicts: [] };
  return have === ids.olWork ? { conflicts: [] } : { conflicts: [`work already has Open Library id ${have}, not ${ids.olWork}`] };
}

export type EditionRow = { id: string; work_id: string; isbn13: string | null; isbn10: string | null; openlibrary_edition_id: string | null; google_volume_id: string | null };
export type EditionBody = { isbn13?: string; isbn10?: string; openlibrary_edition_id?: string; google_volume_id?: string };
export type EditionPlan =
  | { action: 'none' }
  | { action: 'insert'; body: EditionBody }
  | { action: 'update'; id: string; body: EditionBody }
  | { action: 'same'; id: string }
  | { action: 'conflict'; reason: string };

const wanted = (ids: EditionIds): EditionBody => ({
  ...(ids.isbn13 ? { isbn13: ids.isbn13 } : {}), ...(ids.isbn10 ? { isbn10: ids.isbn10 } : {}),
  ...(ids.olEdition ? { openlibrary_edition_id: ids.olEdition } : {}), ...(ids.gbVolume ? { google_volume_id: ids.gbVolume } : {}),
});

/**
 * `rows` = the catalog editions that already carry ANY of these ids. None: create one for this work. Exactly one, in this work, with no
 * contradicting id: fill its empty id columns. Several editions, another work's edition, or a different value in a filled column: conflict, no write.
 */
export function planEdition(workId: string, ids: EditionIds, rows: EditionRow[]): EditionPlan {
  const body = wanted(ids);
  if (!Object.keys(body).length) return { action: 'none' };
  if (!rows.length) return { action: 'insert', body };
  const distinct = [...new Set(rows.map(r => r.id))];
  if (distinct.length > 1) return { action: 'conflict', reason: 'these ids belong to different catalog editions' };
  const row = rows[0];
  if (row.work_id !== workId) return { action: 'conflict', reason: 'an id already belongs to an edition of a different catalog book' };
  const patch: EditionBody = {};
  for (const [k, v] of Object.entries(body) as [keyof EditionBody, string][]) {
    const cur = row[k];
    if (!cur) patch[k] = v;
    else if (cur !== v) return { action: 'conflict', reason: `edition already has ${k} ${cur}, not ${v}` };
  }
  return Object.keys(patch).length ? { action: 'update', id: row.id, body: patch } : { action: 'same', id: row.id };
}
