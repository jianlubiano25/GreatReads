/** Test helpers: a scripted fetch, so source failures and successes can be simulated without a network. Not used by the app. */
export type Reply = { status?: number; body?: unknown; html?: boolean; throws?: boolean };
export type Route = (url: URL) => Reply | undefined;

export function routeFetch(routes: Route[]): string[] {
  const calls: string[] = [];
  (globalThis as any).fetch = async (input: any) => {
    const raw = String(input);
    calls.push(raw);
    const url = new URL(raw, 'https://greatreads.test');
    for (const r of routes) {
      const reply = r(url);
      if (!reply) continue;
      if (reply.throws) throw new TypeError('network down');
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
          if (reply.html) throw new SyntaxError('Unexpected token <');
          return reply.body;
        },
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}

export const nytList = (titles: [string, string, string][]) => ({
  results: {
    list_name_encoded: 'x',
    published_date: '2026-10-04',
    books: titles.map(([title, author, isbn], i) => ({ rank: i + 1, rank_last_week: i + 1, weeks_on_list: 3, title: title.toUpperCase(), author, description: `${title} description`, publisher: 'P', book_image: `https://img/${isbn}.jpg`, primary_isbn13: isbn, primary_isbn10: '' })),
  },
});

export const olWorks = (rows: { key: string; title: string; author: string; subject?: string[]; ratings?: number; year?: number }[]) => ({
  works: rows.map(r => ({ key: r.key, title: r.title, author_name: [r.author], cover_i: 100, first_publish_year: r.year ?? 2025, ratings_count: r.ratings ?? 300, ratings_average: 4.1, subject: r.subject })),
});

export const appleChart = (rows: { id: string; name: string; artist: string; genres: string[] }[]) => ({
  feed: { results: rows.map(r => ({ id: r.id, name: r.name, artistName: r.artist, artworkUrl100: `https://a/${r.id}/100x100bb.jpg`, genres: r.genres.map(name => ({ name })) })) },
});
