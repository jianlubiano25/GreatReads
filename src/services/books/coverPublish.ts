import { applySharedCovers } from './sharedCovers';
import type { CoverPick } from './coverRecords';

/** Publishing the owner's picks for everyone (used only by the Publish book covers screen, which loads on demand). */

export type PublishResult =
  | { ok: true; count: number; dropped: number }
  | { ok: false; reason: 'unauthorized' | 'not_configured' | 'too_large' | 'invalid' | 'network' | 'error' };

/**
 * What will be published: what is already published, with your own picks laid over it (yours win), minus what you removed.
 * Starting from the published set means a new phone with no picks of its own can never wipe the set by publishing.
 */
export function buildDraft(shared: Record<string, CoverPick>, mine: Record<string, CoverPick>, removed: ReadonlySet<string>): Record<string, CoverPick> {
  const out: Record<string, CoverPick> = { ...shared, ...mine };
  removed.forEach(k => delete out[k]);
  return out;
}

export type DraftStatus = 'new' | 'changed' | 'published';
export const draftStatus = (key: string, rec: CoverPick, shared: Record<string, CoverPick>): DraftStatus => (!shared[key] ? 'new' : shared[key].url !== rec.url ? 'changed' : 'published');

/** How many entries differ from what is published: added or changed, and taken away. */
export function countChanges(draft: Record<string, CoverPick>, shared: Record<string, CoverPick>): { changed: number; removed: number } {
  let changed = 0;
  for (const [k, rec] of Object.entries(draft)) if (draftStatus(k, rec, shared) !== 'published') changed++;
  const removed = Object.keys(shared).filter(k => !(k in draft)).length;
  return { changed, removed };
}

export async function publishCovers(draft: Record<string, CoverPick>, token: string): Promise<PublishResult> {
  let res: Response;
  try {
    res = await fetch('/api/covers', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ picks: draft }) });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!res.ok) {
    let error = '';
    try { error = String((await res.json())?.error || ''); } catch {}
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    if (res.status === 503 && error === 'not_configured') return { ok: false, reason: 'not_configured' };
    if (res.status === 413) return { ok: false, reason: 'too_large' };
    if (res.status === 400) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: 'error' };
  }
  try {
    const body = await res.json();
    applySharedCovers(Number(body.v) || Date.now(), body.picks); // everyone, this device included, now draws the published set
    return { ok: true, count: Object.keys(body.picks || {}).length, dropped: Number(body.dropped) || 0 };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
