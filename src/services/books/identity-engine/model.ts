/**
 * Shared evidence model for book identity. Compatibility adapters keep stored Book records unchanged.
 * Provider IDs here never replace GreatReads' personal Book.id.
 */

export type IdentitySource = 'openlibrary' | 'google' | 'apple' | 'nyt' | 'supabase' | 'manual';
export type EntityKind = 'author' | 'work' | 'edition' | 'record';

export interface ExternalIdentifier {
  source: IdentitySource;
  kind: EntityKind;
  value: string;
  scheme?: 'isbn10' | 'isbn13' | 'provider-id';
}

export type EvidenceBasis = 'provider-link' | 'same-edition' | 'author-authority' | 'owner-confirmed' | 'catalog-link' | 'known-title-map' | 'legacy-verified-alias' | 'author-initial' | 'author-name-variant' | 'explicit-title-author' | 'exact-title-author';
export interface IdentityEvidence {
  basis: EvidenceBasis;
  source?: IdentitySource;
  identifier?: ExternalIdentifier;
  note?: string;
}

export type MatchStatus = 'confirmed' | 'probable' | 'ambiguous' | 'conflict' | 'distinct-work';
export type MatchPurpose = 'search' | 'library-merge';
export interface MatchOutcome {
  status: MatchStatus;
  evidence: IdentityEvidence[];
  conflicts: string[];
  /** Human-readable reason suitable for diagnostics and fixture output. */
  reason: string;
}

export interface AuthorAlias {
  name: string;
  evidence: IdentityEvidence;
}
export interface AuthorIdentity {
  /** Provider authority IDs, such as Open Library author keys, are stronger than names. */
  identifiers: ExternalIdentifier[];
  canonicalName?: string;
  aliases: AuthorAlias[];
}

export type TitleAliasKind = 'translation' | 'alternate-title' | 'dual-title' | 'transliteration';
export interface TitleAlias {
  title: string;
  kind: TitleAliasKind;
  evidence: IdentityEvidence;
}
export interface WorkIdentity {
  identifiers: ExternalIdentifier[];
  canonicalTitle?: string;
  /** Related works such as sequels are represented as links, never folded into this work. */
  relatedWorkIds: ExternalIdentifier[];
  /** A title alias is accepted only when an explicit evidence edge connects it to this work. */
  titleAliases: TitleAlias[];
}
export interface EditionIdentity {
  identifiers: ExternalIdentifier[];
  isbn10?: string;
  isbn13?: string;
  language?: string;
  publicationYear?: number;
}

/** A provider record plus optional legacy identity fields; personalId is informational and never matching evidence. */
export interface IdentityRecord {
  personalId?: string | number;
  title: string;
  author?: string;
  authors?: AuthorIdentity[];
  work?: WorkIdentity;
  edition?: EditionIdentity;
  identifiers: ExternalIdentifier[];
}

export interface LegacyBookIdentity {
  olWork?: string;
  olEdition?: string;
  gbVolume?: string;
  isbn13?: string;
  isbn10?: string;
}

export interface LegacyBookLike {
  id: string | number;
  title: string;
  author?: string;
  identity?: LegacyBookIdentity;
}
