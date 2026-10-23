import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExternalIdentifier, IdentityRecord, TitleAlias } from './model';
import { fromLegacyBook, isSearchCandidate, legacySameWork, matchIdentity, mayAutoMerge, normalizeIdentityText, validIsbn10, validIsbn13 } from './match';

const olWork = (value: string): ExternalIdentifier => ({ source: 'openlibrary', kind: 'work', value });
const base = (title: string, author: string, identifiers: ExternalIdentifier[] = []): IdentityRecord => ({ title, author, identifiers, work: { identifiers: identifiers.filter(i => i.kind === 'work'), canonicalTitle: title, relatedWorkIds: [], titleAliases: [] } });
const alias = (title: string, kind: TitleAlias['kind'] = 'translation'): TitleAlias => ({ title, kind, evidence: { basis: 'catalog-link', source: 'supabase', identifier: { source: 'supabase', kind: 'work', value: 'catalog-work-123' }, note: 'fixture: explicit provider edition link' } });

test('same-title books by different known authors remain distinct (The Witch)', () => {
  const a = base('The Witch', 'Freida McFadden');
  const b = base('The Witch', 'Marie Ndiaye');
  const result = matchIdentity(a, b);
  assert.equal(result.status, 'distinct-work');
  assert.equal(mayAutoMerge(result, 'search'), false);
});

test('empty author keys never authorize a match; multilingual author names stay distinct', () => {
  const a = base('絵', '雨穴');
  const b = base('絵', '別の人');
  assert.notEqual(normalizeIdentityText(a.author), '');
  assert.notEqual(normalizeIdentityText(b.author), '');
  assert.equal(matchIdentity(a, b).status, 'distinct-work');
});

test('Unicode normalization is stable for compatibility forms, Latin accents, and non-Latin scripts', () => {
  assert.equal(normalizeIdentityText('Ａlbert  Camus'), normalizeIdentityText('Albert Camus'));
  assert.equal(normalizeIdentityText('L’Étranger'), normalizeIdentityText('L Etranger'));
  assert.equal(normalizeIdentityText('雨穴'), normalizeIdentityText('雨穴'));
  assert.notEqual(normalizeIdentityText('雨穴'), normalizeIdentityText('別の人'));
  assert.equal(normalizeIdentityText('ά'), normalizeIdentityText('α\u0301'));
});

test('same subtitle-less series root is ambiguous; differing explicit subtitles are distinct', () => {
  const a = base('Dune', 'Frank Herbert');
  const sequel = base('Dune: Messiah', 'Frank Herbert');
  assert.equal(matchIdentity(a, sequel).status, 'ambiguous');
  assert.equal(matchIdentity(base('Mistborn: The Final Empire', 'Brandon Sanderson'), base('Mistborn: The Well of Ascension', 'Brandon Sanderson')).status, 'distinct-work');
});

test('same normalized title and author is probable, not a confirmed destructive merge', () => {
  const result = matchIdentity(base('Writers & Lovers: A Novel', 'Lily King'), base('Writers and Lovers', 'King, Lily'));
  assert.equal(result.status, 'probable');
  assert.equal(mayAutoMerge(result, 'search'), true);
  assert.equal(mayAutoMerge(result, 'library-merge'), false);
});

test('a matching title with missing author metadata stays ambiguous', () => {
  const result = matchIdentity(base('The Witch', ''), base('The Witch', 'Freida McFadden'));
  assert.equal(result.status, 'ambiguous');
  assert.equal(isSearchCandidate(result), true);
  assert.equal(mayAutoMerge(result, 'library-merge'), false);
});

test('same validated provider work ID confirms a work despite differing record IDs', () => {
  const a = base('Dune', 'Frank Herbert', [olWork('OL45883W')]);
  const b = base('Dune', 'Frank Herbert', [olWork('OL45883W')]);
  assert.equal(matchIdentity({ ...a, personalId: 'ol__works_OL45883W' }, { ...b, personalId: 'local-42' }).status, 'confirmed');
});

test('different work IDs from the same provider are a conflict, not a title-based merge', () => {
  const result = matchIdentity(base('Dune', 'Frank Herbert', [olWork('OL1W')]), base('Dune', 'Frank Herbert', [olWork('OL2W')]));
  assert.equal(result.status, 'conflict');
  assert.equal(mayAutoMerge(result, 'search'), false);
});

test('shared ISBN confirms an edition only when descriptive metadata does not materially conflict', () => {
  const edition = { identifiers: [], isbn13: '9780802148537' };
  const a = { ...base('Writers & Lovers', 'Lily King'), edition };
  const b = { ...base('Writers & Lovers', 'Someone Else'), edition };
  const result = matchIdentity(a, b);
  assert.equal(result.status, 'conflict');
  assert.equal(result.conflicts.length, 1);
});

test('shared provider work ID with incompatible titles is a conflict', () => {
  const result = matchIdentity(base('Writers & Lovers', 'Lily King', [olWork('OL7W')]), base('A Different Work', 'Lily King', [olWork('OL7W')]));
  assert.equal(result.status, 'conflict');
});

test('valid ISBN-10 and ISBN-13 forms resolve to the same edition; bad check digits are ignored', () => {
  assert.equal(validIsbn10('0802148530'), true);
  assert.equal(validIsbn13('9780802148537'), true);
  assert.equal(validIsbn13('9780802148538'), false);
  const a = { ...base('Writers & Lovers', 'Lily King'), edition: { identifiers: [], isbn10: '0802148530' } };
  const b = { ...base('Writers & Lovers', 'Lily King'), edition: { identifiers: [], isbn13: '9780802148537' } };
  assert.equal(matchIdentity(a, b).status, 'confirmed');
  const c = { ...base('Writers & Lovers', 'Lily King'), edition: { identifiers: [], isbn13: '9780802148538' } };
  assert.equal(matchIdentity(a, c).status, 'probable');
});

test('a translation title requires an explicit evidence link; title resemblance alone is insufficient', () => {
  const foreign = base('L’étranger', 'Albert Camus', [olWork('OL123W')]);
  foreign.work!.titleAliases = [alias('The Stranger')];
  const english = base('The Stranger', 'Albert Camus');
  const result = matchIdentity(foreign, english);
  assert.equal(result.status, 'probable');
  assert.equal(result.evidence[0]?.basis, 'catalog-link');
  assert.equal(matchIdentity(base('The Outsider', 'Albert Camus'), base('The Stranger', 'Albert Camus')).status, 'distinct-work');
});

test('legacy adapter preserves personal IDs and recognizes only well-formed embedded provider IDs', () => {
  const old = fromLegacyBook({ id: 'ol__works_OL123W', title: 'The Stranger', author: 'Albert Camus' });
  assert.equal(old.personalId, 'ol__works_OL123W');
  assert.deepEqual(old.work?.identifiers, [olWork('OL123W')]);
  assert.equal(legacySameWork({ id: 'ol__works_OL123W', title: 'The Stranger', author: 'Albert Camus' }, { id: 'local-book', title: 'The Stranger', author: 'Albert Camus' }), true);
  assert.equal(fromLegacyBook({ id: 'personal-OL123W', title: 'The Stranger', author: 'Albert Camus' }).work?.identifiers.length, 0);
});

test('personal IDs never make otherwise unrelated provider records match', () => {
  const a = fromLegacyBook({ id: 'mine-1', title: 'Book A', author: 'Writer A' });
  const b = fromLegacyBook({ id: 'mine-1', title: 'Book B', author: 'Writer B' });
  assert.equal(matchIdentity(a, b).status, 'distinct-work');
});

test('author authority IDs can connect name variants without fuzzy name matching', () => {
  const authorA = { identifiers: [{ source: 'openlibrary' as const, kind: 'author' as const, value: 'OL1A' }], canonicalName: 'Ursula Vernon', aliases: [] };
  const authorB = { identifiers: [{ source: 'openlibrary' as const, kind: 'author' as const, value: 'OL1A' }], canonicalName: 'T. Kingfisher', aliases: [] };
  const a: IdentityRecord = { ...base('Nettle & Bone', 'Ursula Vernon'), authors: [authorA] };
  const b: IdentityRecord = { ...base('Nettle & Bone', 'T. Kingfisher'), authors: [authorB] };
  assert.equal(matchIdentity(a, b).status, 'probable');
});

test('contradictory author authority IDs conflict even when display names happen to match', () => {
  const a = { identifiers: [{ source: 'openlibrary' as const, kind: 'author' as const, value: 'OL1A' }], canonicalName: 'Alex Writer', aliases: [] };
  const b = { identifiers: [{ source: 'openlibrary' as const, kind: 'author' as const, value: 'OL2A' }], canonicalName: 'Alex Writer', aliases: [] };
  const result = matchIdentity({ ...base('Same Title', 'Alex Writer'), authors: [a] }, { ...base('Same Title', 'Alex Writer'), authors: [b] });
  assert.equal(result.status, 'conflict');
});

test('unsupported author-name aliases do not become match evidence', () => {
  const a = { ...base('Nettle & Bone', 'Ursula Vernon'), authors: [{ identifiers: [], canonicalName: 'Ursula Vernon', aliases: [{ name: 'T. Kingfisher', evidence: { basis: 'catalog-link' as const, note: 'unverified' } }] }] };
  const b = base('Nettle & Bone', 'T. Kingfisher');
  assert.equal(matchIdentity(a, b).status, 'distinct-work');
});

test('unsupported title aliases do not establish a translation link', () => {
  const a = base('L’étranger', 'Albert Camus');
  a.work!.titleAliases = [{ title: 'The Stranger', kind: 'translation', evidence: { basis: 'catalog-link', source: 'supabase', note: 'no catalog ID' } }];
  assert.equal(matchIdentity(a, base('The Stranger', 'Albert Camus')).status, 'distinct-work');
});
