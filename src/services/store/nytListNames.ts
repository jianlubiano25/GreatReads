/**
 * Checks the NYT list names the Store asks for against the names the NYT Books API itself publishes
 * (GET /svc/books/v3/lists/names.json). Pure: `npm run check:nyt` fetches the real names (needs NYT_API_KEY) and calls this.
 */
export interface NytListName { list_name_encoded?: string; display_name?: string; list_name?: string; updated?: string; newest_published_date?: string }

export interface NytListCheck {
  /** Shelves whose list name the NYT does not publish: these would never load */
  missing: { id: string; list: string; suggestions: string[] }[];
  found: { id: string; list: string; display: string; updated: string }[];
}

export function checkNytLists(names: NytListName[], wanted: { id: string; list: string }[]): NytListCheck {
  const byName = new Map(names.filter(n => n.list_name_encoded).map(n => [n.list_name_encoded as string, n]));
  const out: NytListCheck = { missing: [], found: [] };
  for (const w of wanted) {
    const n = byName.get(w.list);
    if (n) { out.found.push({ id: w.id, list: w.list, display: n.display_name || n.list_name || w.list, updated: n.updated || 'unknown' }); continue; }
    const words = w.list.split('-').filter(x => x.length > 3);
    const suggestions = [...byName.entries()].filter(([k, n]) => words.some(x => k.includes(x) || `${n.display_name || ''} ${n.list_name || ''}`.toLowerCase().includes(x))).map(([k]) => k).slice(0, 8);
    out.missing.push({ id: w.id, list: w.list, suggestions });
  }
  return out;
}
