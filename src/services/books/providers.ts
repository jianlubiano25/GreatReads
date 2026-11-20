/**
 * The four book providers and how the catalog spells them: ONE place, so a provider is added or renamed here and nowhere else.
 * Open Library (OL), Google Books (GB), Apple Books (AB), Hardcover (HC). Capture (capture.ts), Save to catalog (catalog.ts) and the receipts (catalogReceipts.ts) all read this.
 *
 * Where each part of the four-provider pipeline lives (every step is owner-only, unpublished, idempotent and fill-only; one shared entry, `saveFactsToCatalog` in catalog.ts, is
 * used by BOTH Save to catalog and the background capture / "Send and publish everything on this device"):
 *   what a provider said (memory)   books/providerFacts.ts      (adapters in books/sources/ note it; never a request of its own)
 *   receipt per provider record     catalogReceipts.ts          -> catalog_provider_records
 *   facts as metadata candidates    catalog.ts FACT_FIELDS      -> catalog_metadata_candidates (source + record id + receipt)
 *   description / cover link        catalogProviderCandidates.ts -> catalog_content_versions, catalog_cover_candidates
 *   genre / subject -> catalog term catalogTerms.ts (mapLabelsToTerms is pure; vocabulary in catalog_terms + catalog_term_aliases) -> catalog_work_terms
 *   ratings (one per site)          catalog.ts storeRating      -> catalog_rating_candidates (RATING_SOURCE below)
 */
export const PROVIDERS = ['apple', 'google', 'openlibrary', 'hardcover'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** `catalog_rating_candidates.source_name` (the DB spells the sites differently from `catalog_provider_records.provider`, which uses the Provider value itself). */
export const RATING_SOURCE: Record<Provider, string> = { apple: 'apple_books', google: 'google_books', openlibrary: 'open_library', hardcover: 'hardcover' };

/** `catalog_provider_records.record_kind`: what a provider's own id points at. */
export const RECEIPT_KIND: Record<Provider, 'listing' | 'volume' | 'work'> = { apple: 'listing', google: 'volume', openlibrary: 'work', hardcover: 'work' };

export const PROVIDER_LABEL: Record<Provider, string> = { apple: 'Apple Books', google: 'Google Books', openlibrary: 'Open Library', hardcover: 'Hardcover' };

export const isProvider = (p: unknown): p is Provider => typeof p === 'string' && (PROVIDERS as readonly string[]).includes(p);
