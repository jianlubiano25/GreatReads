import type {
  EditionIdentity, ExternalIdentifier, IdentityEvidence, IdentityRecord, LegacyBookLike,
  MatchOutcome, MatchPurpose, MatchStatus, TitleAlias, WorkIdentity,
} from './model';

const idKey = (i: ExternalIdentifier) => i.scheme === 'isbn10' || i.scheme === 'isbn13'
  ? `isbn:${canonicalIsbn13(i.value) || i.value}`
  : `${i.source}:${i.kind}:${i.value}`;
function validIsbn10(value: string): boolean {
  const s = value.replace(/[\s-]/g, '').toUpperCase();
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  return [...s].reduce((sum, c, i) => sum + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;
}
function validIsbn13(value: string): boolean {
  const s = value.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(s)) return false;
  const sum = [...s.slice(0, 12)].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(s[12]);
}
const validNonIsbnId = (i: ExternalIdentifier): boolean => {
  const v = i.value.trim();
  if (!v) return false;
  if (i.scheme === 'isbn10') return i.kind === 'edition' && validIsbn10(v);
  if (i.scheme === 'isbn13') return i.kind === 'edition' && validIsbn13(v);
  if (i.scheme === 'provider-id' && !v) return false;
  if (i.source === 'openlibrary') {
    if (i.kind === 'work') return /^OL\d+W$/i.test(v);
    if (i.kind === 'edition') return /^OL\d+M$/i.test(v);
    if (i.kind === 'author') return /^OL\d+A$/i.test(v);
  }
  return v.length <= 200 && !/[\u0000-\u001f]/.test(v);
};

/** Unicode aware, locale independent normalization. Latin accents fold; marks in other scripts are retained. */
export function normalizeIdentityText(input = ''): string {
  const compat = input.normalize('NFKC').toLowerCase().replace(/&/g, ' and ');
  let folded = '';
  for (const char of compat) {
    const decomposed = char.normalize('NFD');
    const base = [...decomposed].find(c => !/\p{M}/u.test(c));
    // Remove Latin diacritics only; decomposed non-Latin marks stay attached exactly once.
    if (base && /\p{Script=Latin}/u.test(base)) folded += base;
    else folded += decomposed;
  }
  return folded.replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeAuthorIdentity(input = ''): string {
  const parts = input.split(',').map(x => x.trim()).filter(Boolean);
  const name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : input;
  return normalizeIdentityText(name.replace(/\bal[-‐‑–—](?=\p{L})/giu, 'al').replace(/\b(jr|sr|ii|iii|phd|md)\b/gi, ' '));
}

function authorInitialMatch(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) for (const y of b) {
    const left = x.split(' '), right = y.split(' ');
    if (left.length === right.length && left.length > 1 && left.at(-1) === right.at(-1)
      && left.slice(0, -1).every((part, i) => part[0] === right[i]?.[0])
      && (left.some(p => p.length === 1) || right.some(p => p.length === 1))) return true;
  }
  return false;
}

function authorVariants(input: string): Set<string> {
  const name = normalizeAuthorIdentity(input);
  const words = name.split(' ').filter(Boolean);
  const variants = new Set(name ? [name] : []);
  if (words.length >= 3) {
    variants.add(`${words[0]} ${words.at(-1)}`);
    variants.add(words.slice(-2).join(' '));
  }
  return variants;
}
export function authorNameVariantMatch(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) for (const y of b) {
    const xv = authorVariants(x), yv = authorVariants(y);
    if ([...xv].some(v => yv.has(v))) return true;
  }
  return false;
}
export function authorNamesAreSearchVariants(a: string, b: string): boolean {
  const leftName = normalizeAuthorIdentity(a), rightName = normalizeAuthorIdentity(b);
  if (!leftName || !rightName) return false;
  const left = leftName.split(' '), right = rightName.split(' ');
  if (authorNameVariantMatch(new Set([leftName]), new Set([rightName])) || authorInitialMatch(new Set([leftName]), new Set([rightName]))) return true;
  const sequence = (long: string[], short: string[]) => long.length > short.length && long.slice(-short.length).every((part, i) => part === short[i]);
  if (sequence(left, right) || sequence(right, left)) return true;
  if (left.length !== right.length && left[0] === right[0] && left.at(-1) === right.at(-1)) return true;
  if (left.length !== right.length) return false;
  return left.at(-1) === right.at(-1)
    && left.slice(0, -1).every((part, i) => part[0] === right[i]?.[0])
    && (left.some(x => x.length === 1) || right.some(x => x.length === 1));
}

export { validIsbn10, validIsbn13 };

function canonicalIsbn13(value = ''): string | undefined {
  const s = value.replace(/[\s-]/g, '').toUpperCase();
  if (validIsbn13(s)) return s;
  if (!validIsbn10(s)) return undefined;
  const core = `978${s.slice(0, 9)}`;
  const sum = [...core].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0);
  return `${core}${(10 - sum % 10) % 10}`;
}

function cleanIds(ids: readonly ExternalIdentifier[]): ExternalIdentifier[] {
  return ids.map(i => ({ ...i, value: i.value.trim() })).filter(validNonIsbnId);
}
function editionIds(e?: EditionIdentity): ExternalIdentifier[] {
  if (!e) return [];
  const ids = [...e.identifiers];
  for (const raw of [e.isbn10, e.isbn13]) {
    const canonical = raw && canonicalIsbn13(raw);
    if (canonical) ids.push({ source: 'manual', kind: 'edition', value: canonical, scheme: 'isbn13' });
  }
  return cleanIds(ids);
}
function workIds(w?: WorkIdentity): ExternalIdentifier[] { return cleanIds(w?.identifiers || []).filter(i => i.kind === 'work'); }
function allIds(r: IdentityRecord): ExternalIdentifier[] {
  return cleanIds([...r.identifiers, ...workIds(r.work), ...editionIds(r.edition)]);
}

function validEvidence(e: IdentityEvidence): boolean {
  if (e.basis === 'owner-confirmed' || e.basis === 'known-title-map' || e.basis === 'legacy-verified-alias') return true;
  return !!e.identifier && validNonIsbnId(e.identifier);
}
function titleSet(r: IdentityRecord): Set<string> {
  const entries: TitleAlias[] = (r.work?.titleAliases || []).filter(a => validEvidence(a.evidence));
  return new Set([r.title, r.work?.canonicalTitle || '', ...entries.map(a => a.title)].map(normalizeIdentityText).filter(Boolean));
}
function authorSet(r: IdentityRecord): Set<string> {
  const names = [r.author, ...(r.authors || []).flatMap(a => [a.canonicalName, ...a.aliases.filter(x => validEvidence(x.evidence)).map(x => x.name)])];
  return new Set(names.map(normalizeAuthorIdentity).filter(name => name && !/^(unknown|featured)( author)?$/.test(name)));
}
function authorIds(r: IdentityRecord): ExternalIdentifier[] {
  return cleanIds((r.authors || []).flatMap(a => a.identifiers)).filter(i => i.kind === 'author');
}
function conflictingAuthorityId(a: ExternalIdentifier[], b: ExternalIdentifier[]): boolean {
  return a.some(x => b.some(y => x.source === y.source && x.kind === y.kind && x.value !== y.value));
}
function commonIdentifier(a: ExternalIdentifier[], b: ExternalIdentifier[]): ExternalIdentifier | undefined {
  const keys = new Set(a.map(idKey));
  return b.find(i => keys.has(idKey(i)));
}
function hasExplicitTitleLink(a: IdentityRecord, b: IdentityRecord): TitleAlias | undefined {
  const aTitles = new Set([normalizeIdentityText(a.title), ...(a.work?.titleAliases || []).filter(x => validEvidence(x.evidence)).map(x => normalizeIdentityText(x.title))].filter(Boolean));
  const bTitles = new Set([normalizeIdentityText(b.title), ...(b.work?.titleAliases || []).filter(x => validEvidence(x.evidence)).map(x => normalizeIdentityText(x.title))].filter(Boolean));
  const linked = [...(a.work?.titleAliases || []), ...(b.work?.titleAliases || [])].find(x => validEvidence(x.evidence) && aTitles.has(normalizeIdentityText(x.title)) && bTitles.has(normalizeIdentityText(x.title)) && ['translation', 'alternate-title', 'dual-title', 'transliteration'].includes(x.kind));
  return linked;
}
function subtitleParts(title: string): { main: string; subtitle: string } {
  const clean = title.normalize('NFKC').replace(/\(.*?\)|\[.*?\]/g, ' ');
  const [main = '', ...rest] = clean.split(/\s*[:–—]\s+|\s+-\s+/);
  const rawSubtitle = rest.join(' ');
  const subtitle = normalizeIdentityText(rest.join(' ')).replace(/^(the|a|an) /, '');
  const generic = /^(a )?(novel|memoir|stories|short stories|special edition|deluxe edition|illustrated edition)$/;
  const descriptive = /\b(book club|club pick|special edition|deluxe|illustrated|annotated|winner|award|prize|netflix|movie|tv series)\b/.test(subtitle)
    || /,/.test(rawSubtitle) || /^(how|why|what|when|where|who)\b/.test(subtitle) || subtitle.split(' ').filter(Boolean).length >= 6;
  return { main: normalizeIdentityText(main), subtitle: generic.test(subtitle) || descriptive ? '' : subtitle };
}
const misleadingSubtitle = /\b(study guide|summary of|workbook|analysis of|reader'?s guide|teacher'?s guide)\b/i;
function outcome(status: MatchStatus, reason: string, evidence: IdentityEvidence[] = [], conflicts: string[] = []): MatchOutcome {
  return { status, reason, evidence, conflicts };
}

/** Compare book records conservatively; a score is intentionally not exposed as a merge decision. */
export function matchIdentity(a: IdentityRecord, b: IdentityRecord): MatchOutcome {
  const ai = allIds(a), bi = allIds(b);
  const sharedEdition = commonIdentifier(ai.filter(x => x.kind === 'edition'), bi.filter(x => x.kind === 'edition'));
  const sharedWork = commonIdentifier(workIds(a.work), workIds(b.work)) || commonIdentifier(ai.filter(x => x.kind === 'work'), bi.filter(x => x.kind === 'work'));
  const distinctWorkId = ai.some(x => x.kind === 'work' && bi.some(y => y.source === x.source && y.kind === 'work' && y.value !== x.value));
  const aAuthors = authorSet(a), bAuthors = authorSet(b);
  const aAuthorIds = authorIds(a), bAuthorIds = authorIds(b);
  const sharedAuthor = commonIdentifier(aAuthorIds, bAuthorIds);
  const authorIdConflict = conflictingAuthorityId(aAuthorIds, bAuthorIds);
  const knownAuthors = aAuthors.size > 0 && bAuthors.size > 0;
  const authorsOverlap = [...aAuthors].some(x => bAuthors.has(x)) || !!sharedAuthor;
  const authorInitialsOverlap = authorInitialMatch(aAuthors, bAuthors);
  const authorVariantOverlap = authorNameVariantMatch(aAuthors, bAuthors);
  const titlesOverlap = [...titleSet(a)].some(x => titleSet(b).has(x));
  if (normalizeIdentityText(a.title) !== normalizeIdentityText(b.title) && (misleadingSubtitle.test(a.title) || misleadingSubtitle.test(b.title))) {
    return outcome('distinct-work', 'A study guide or analysis title is not the underlying book.');
  }
  const titleRootsOverlap = subtitleParts(a.title).main === subtitleParts(b.title).main && !!subtitleParts(a.title).main;
  const titleLink = hasExplicitTitleLink(a, b);
  const titleSameOrLinked = titlesOverlap || titleRootsOverlap || !!titleLink;
  const contradictions: string[] = [];
  if (knownAuthors && !authorsOverlap && !authorInitialsOverlap && !authorVariantOverlap) contradictions.push('Known author names or aliases do not agree.');
  if (authorIdConflict) contradictions.push('Author authority identifiers from the same provider disagree.');
  if ((sharedEdition || sharedWork) && titleSet(a).size && titleSet(b).size && !titleSameOrLinked) {
    contradictions.push('Titles do not agree and no explicit alternate-title link is present.');
  }
  if (distinctWorkId) contradictions.push('Different work identifiers from the same provider disagree.');

  // A strong shared identifier with contradictory descriptive data is quarantined as conflict, never auto-merged.
  if ((sharedEdition || sharedWork) && contradictions.length) {
    return outcome('conflict', 'Shared identifier conflicts with known author or work identity.', sharedEdition || sharedWork ? [{ basis: sharedEdition ? 'same-edition' : 'provider-link', identifier: sharedEdition || sharedWork, source: (sharedEdition || sharedWork)!.source }] : [], contradictions);
  }
  if (sharedEdition) return outcome('confirmed', 'Same validated edition identifier.', [{ basis: 'same-edition', source: sharedEdition.source, identifier: sharedEdition }]);
  if (sharedWork) return outcome('confirmed', 'Same provider work identifier.', [{ basis: 'provider-link', source: sharedWork.source, identifier: sharedWork }]);
  if (distinctWorkId) return outcome('conflict', 'Provider work identifiers disagree.', [], contradictions);
  if (authorIdConflict) return outcome('conflict', 'Author authority identifiers disagree.', [], contradictions);
  if (knownAuthors && !authorsOverlap && !authorInitialsOverlap && !authorVariantOverlap) return outcome('distinct-work', 'Same or related title cannot override different known authors.', [], contradictions);

  if (titleLink && (!knownAuthors || authorsOverlap || authorVariantOverlap)) {
    const explicitSameAuthor = knownAuthors && authorsOverlap;
    const evidence = explicitSameAuthor && ['known-title-map', 'catalog-link', 'owner-confirmed'].includes(titleLink.evidence.basis)
      ? [titleLink.evidence, { basis: 'explicit-title-author' as const }]
      : [titleLink.evidence];
    return outcome('probable', `Explicit ${titleLink.kind} title link; author evidence is ${knownAuthors ? 'consistent' : 'missing'}.`, evidence);
  }
  if (!titleSameOrLinked) return outcome('distinct-work', 'No explicit title or work identity link.');

  const [ta, tb] = [subtitleParts(a.title), subtitleParts(b.title)];
  const shortenedMatch = ta.subtitle && tb.subtitle && (ta.subtitle.startsWith(tb.subtitle) || tb.subtitle.startsWith(ta.subtitle));
  if (ta.main && ta.main === tb.main && ta.subtitle && tb.subtitle && ta.subtitle !== tb.subtitle && !shortenedMatch) {
    return outcome('distinct-work', 'Series-style subtitles identify different works.');
  }
  if (ta.main && ta.main === tb.main && (!!ta.subtitle !== !!tb.subtitle)) {
    return outcome('ambiguous', 'One record is missing a subtitle that may distinguish a series work.');
  }
  if (!knownAuthors) return outcome('ambiguous', 'Title matches, but a non-empty author match is not established.');
  if (authorInitialsOverlap) return outcome('probable', 'Title matches and author initials and surname agree.', [{ basis: 'author-initial', note: 'Search and metadata evidence only; not a stored author alias.' }]);
  if (authorVariantOverlap && !authorsOverlap) return outcome('probable', 'Title and a shortened author-name variant match; this is Search evidence only.', [{ basis: 'author-name-variant', note: 'Name variation can rank and deduplicate Search candidates but cannot merge library records.' }]);
  const exactTitleAuthor = normalizeIdentityText(a.title) === normalizeIdentityText(b.title) && [...aAuthors].some(x => bAuthors.has(x));
  return outcome('probable', 'Normalized title and author match; no stable work or edition identifier is shared.', exactTitleAuthor ? [{ basis: 'exact-title-author' }] : []);
}

/** Search may rank uncertain candidates; personal-library deduplication auto-merges only confirmed identity. */
export function mayAutoMerge(outcome: MatchOutcome, purpose: MatchPurpose): boolean {
  return purpose === 'library-merge'
    ? outcome.status === 'confirmed' || (outcome.status === 'probable' && outcome.evidence.some(e => e.basis === 'exact-title-author' || e.basis === 'explicit-title-author'))
    : outcome.status === 'confirmed' || outcome.status === 'probable';
}

/** Ambiguous records may remain visible and rank in Search, but cannot donate fields to one another automatically. */
export function isSearchCandidate(outcome: MatchOutcome): boolean {
  return outcome.status !== 'conflict' && outcome.status !== 'distinct-work';
}

/** Adapter for old records: recognized legacy provider-ID prefixes become evidence while `personalId` itself remains unchanged. */
export function fromLegacyBook(book: LegacyBookLike): IdentityRecord {
  const legacy = book.identity || {};
  const ids: ExternalIdentifier[] = [];
  const legacyId = String(book.id);
  const olFromLegacyId = legacyId.startsWith('ol_') ? legacyId.match(/OL\d+W/i)?.[0] : undefined;
  const gbFromLegacyId = legacyId.startsWith('gb_') ? legacyId.slice(3) : undefined;
  const isbnFromLegacyId = legacyId.startsWith('isbn_') ? legacyId.slice(5) : undefined;
  const olWork = legacy.olWork || olFromLegacyId;
  const gbVolume = legacy.gbVolume || gbFromLegacyId;
  if (/^OL\d+W$/i.test(olWork || '')) ids.push({ source: 'openlibrary', kind: 'work', value: olWork! });
  if (/^OL\d+M$/i.test(legacy.olEdition || '')) ids.push({ source: 'openlibrary', kind: 'edition', value: legacy.olEdition! });
  if (gbVolume?.trim()) ids.push({ source: 'google', kind: 'edition', value: gbVolume.trim() });
  const rawIsbns = [legacy.isbn10, legacy.isbn13, isbnFromLegacyId].filter((v): v is string => !!v);
  const isbn10 = rawIsbns.find(validIsbn10);
  const isbn13 = rawIsbns.find(validIsbn13);
  return {
    personalId: book.id,
    title: book.title,
    author: book.author,
    identifiers: ids,
    work: { identifiers: ids.filter(i => i.kind === 'work'), canonicalTitle: book.title, relatedWorkIds: [], titleAliases: [] },
    edition: { identifiers: ids.filter(i => i.kind === 'edition'), isbn10, isbn13 },
  };
}

/** Temporary boolean bridge; strict library callers require confirmed evidence only. */
export function legacySameWork(a: LegacyBookLike, b: LegacyBookLike, strict = false): boolean {
  const result = matchIdentity(fromLegacyBook(a), fromLegacyBook(b));
  return strict ? mayAutoMerge(result, 'library-merge') : result.status === 'confirmed' || result.status === 'probable';
}
