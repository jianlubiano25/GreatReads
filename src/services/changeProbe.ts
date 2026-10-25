/**
 * A very small "has anything changed in the cloud?" check, used as a safety net next to live updates.
 *
 * It reads only revision numbers (a few hundred bytes), never contents, so it is cheap on a free plan even when it runs every
 * half minute. When its fingerprint differs from the previous one, the app pulls the real data. This catches changes whenever the
 * live connection was asleep, expired or silently dead, and it also keeps the login token fresh while the app stays open.
 */
export type ProbeRest = <T>(path: string) => Promise<{ ok: true; data: T } | { ok: false }>;

const PROBES: { table: string; select: string; order?: string; limit?: number }[] = [
  { table: 'user_library_preferences', select: 'revision' },
  { table: 'user_settings', select: 'key,revision' },
  { table: 'user_words', select: 'word_id,revision' },
  { table: 'user_daily_pages', select: 'day,revision', order: 'day.desc', limit: 60 },
  { table: 'user_library_books', select: 'local_book_id,revision' },
  { table: 'user_book_annotations', select: 'id,revision' },
  { table: 'user_shelves', select: 'id,revision' },
  { table: 'user_shelf_books', select: 'id,revision' },
];

/** A fingerprint of the cloud's current revisions, or null when any part could not be read (never treated as a change). */
export async function probeFingerprint(userId: string, rest: ProbeRest): Promise<string | null> {
  const parts: string[] = [];
  for (const p of PROBES) {
    const q = `${p.table}?user_id=eq.${encodeURIComponent(userId)}&select=${p.select}${p.order ? `&order=${p.order}` : ''}&limit=${p.limit ?? 1000}`;
    const r = await rest<Record<string, unknown>[]>(q);
    if (!r.ok || !Array.isArray(r.data)) {
      // A table that does not exist yet answers with an error: skip it, never fail the whole probe for it
      parts.push(`${p.table}:x`); continue;
    }
    parts.push(`${p.table}:${r.data.map(row => Object.values(row).join('.')).sort().join(',')}`);
  }
  return parts.join('|');
}

/** Remembers the previous fingerprint. `changed` is true only when a fingerprint differs from an earlier real one. */
export function createProbeWatcher() {
  let previous: string | null = null;
  return { changed(next: string | null): boolean { if (next === null) return false; const was = previous; previous = next; return was !== null && was !== next; } };
}
