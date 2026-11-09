/**
 * The four book providers and how the catalog spells them: ONE place, so a provider is added or renamed here and nowhere else.
 * Open Library (OL), Google Books (GB), Apple Books (AB), Hardcover (HC). Capture (capture.ts), Save to catalog (catalog.ts) and the receipts (catalogReceipts.ts) all read this.
 */
export const PROVIDERS = ['apple', 'google', 'openlibrary', 'hardcover'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** `catalog_rating_candidates.source_name` (the DB spells the sites differently from `catalog_provider_records.provider`, which uses the Provider value itself). */
export const RATING_SOURCE: Record<Provider, string> = { apple: 'apple_books', google: 'google_books', openlibrary: 'open_library', hardcover: 'hardcover' };

/** `catalog_provider_records.record_kind`: what a provider's own id points at. */
export const RECEIPT_KIND: Record<Provider, 'listing' | 'volume' | 'work'> = { apple: 'listing', google: 'volume', openlibrary: 'work', hardcover: 'work' };

export const PROVIDER_LABEL: Record<Provider, string> = { apple: 'Apple Books', google: 'Google Books', openlibrary: 'Open Library', hardcover: 'Hardcover' };

export const isProvider = (p: unknown): p is Provider => typeof p === 'string' && (PROVIDERS as readonly string[]).includes(p);
