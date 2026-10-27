// Run with: npm test
// Phase 1 fill rules: label classification (genre vs honor vs tag), append-only unions, publication dates, the 90-day New Release rule, fill-only edition plans.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAll, classifyLabel, isNewRelease, newReleaseStatus, parsePublicationDate, planEditionFill, planWorkFill, unionKeep, type EditionFillRow } from './catalogFill';

const kinds = (l: string) => classifyLabel(l).map(c => `${c.kind}:${c.value}`);

test('shelf names and awards are honors, never genres', () => {
  for (const l of ["Reese's Book Club", 'Prize winner', 'Service95 Book Club', "Oprah's Book Club - Mar 2026", 'The Inklings', 'Women\'s Prize 2021', 'Booker Prize shortlist']) {
    assert.equal(classifyLabel(l)[0].kind, 'honor', l);
  }
  assert.deepEqual(classifyAll(["Reese's Book Club", 'Prize winner']).genres, []);
});

test('real genres map onto the app spelling; lower case and "Fiction / Fantasy" style labels work', () => {
  assert.deepEqual(kinds('Fantasy'), ['genre:Fantasy']);
  assert.deepEqual(kinds('cookbooks'), ['genre:Cookbooks']);
  assert.deepEqual(kinds('Fiction / Fantasy'), ['genre:Fiction', 'genre:Fantasy']);
  assert.deepEqual(kinds('Science fiction'), ['genre:Science fiction']);
  assert.deepEqual(kinds('Mysteries & Thrillers'), ['genre:Mystery', 'genre:Thriller']);
});

test('tags, "New release" and unknown labels are not genres; empty/placeholder labels give nothing', () => {
  assert.deepEqual(kinds('Reader favourite'), ['tag:Reader favourite']);
  assert.deepEqual(kinds('New release'), ['derived:New release']);
  assert.deepEqual(kinds('Dragons'), ['unmapped:Dragons']);
  assert.deepEqual(classifyLabel('Book'), []);
  assert.deepEqual(classifyLabel(''), []);
  assert.deepEqual(classifyLabel(undefined), []);
});

test('classifyAll de-duplicates, keeps the first spelling and caps genres', () => {
  const c = classifyAll(['Fantasy', 'fantasy', 'Fiction', 'Romance', 'Horror', 'Mystery', 'Crime', 'Classic']);
  assert.equal(c.genres.length, 5);
  assert.deepEqual(c.genres.slice(0, 2), ['Fantasy', 'Fiction']);
});

test('unions only grow: existing entries stay as they are, duplicates ignoring case are not added, no change gives undefined', () => {
  assert.deepEqual(unionKeep(['Fantasy', 'Romance'], ['fantasy', 'Horror']), ['Fantasy', 'Romance', 'Horror']);
  assert.equal(unionKeep(['Fantasy'], ['FANTASY', ' fantasy ']), undefined);
  assert.deepEqual(unionKeep(null, ['A']), ['A']);
  assert.equal(unionKeep(['A'], []), undefined);
});

test('work fill: empty patch when nothing is new; never removes or replaces existing genres/honors', () => {
  assert.deepEqual(planWorkFill({ genres: ['Fantasy'], honors: ['Prize winner'] }, { genres: ['fantasy'], honors: ['prize winner'] }), {});
  const p = planWorkFill({ genres: ['Fantasy'], honors: [] }, { genres: ['Romance'], honors: ["Reese's Book Club"] });
  assert.deepEqual(p, { genres: ['Fantasy', 'Romance'], honors: ["Reese's Book Club"] });
  assert.deepEqual(planWorkFill(null, {}), {});
});

test('publication dates: each form is read, never made more precise than the source, impossible ones are rejected', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.deepEqual(parsePublicationDate('2021', now), { text: '2021', year: 2021, precision: 'year' });
  assert.deepEqual(parsePublicationDate('2021-03', now), { text: '2021-03', year: 2021, precision: 'month' });
  assert.deepEqual(parsePublicationDate('2021-03-03T08:00:00Z', now), { text: '2021-03-03', year: 2021, precision: 'day' });
  assert.deepEqual(parsePublicationDate('March 3, 2021', now), { text: '2021-03-03', year: 2021, precision: 'day' });
  assert.deepEqual(parsePublicationDate('March 2021', now), { text: '2021-03', year: 2021, precision: 'month' });
  for (const bad of ['', 'sometime', '2021-13-01', '2021-02-30', '1200', '2099', undefined, null]) assert.equal(parsePublicationDate(bad as any, now).precision, 'none', String(bad));
});

test('New Release: within 90 days is new, older is not, future is upcoming, missing or partial dates are unknown (never new)', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(newReleaseStatus(['2026-10-27'], now), 'new', 'today');
  assert.equal(newReleaseStatus(['2026-07-29'], now), 'new', 'exactly 90 days ago');
  assert.equal(newReleaseStatus(['2026-07-28'], now), 'no', '91 days ago');
  assert.equal(newReleaseStatus(['2026-11-03'], now), 'upcoming');
  assert.equal(newReleaseStatus([], now), 'unknown');
  assert.equal(newReleaseStatus([null, undefined, ''], now), 'unknown');
  assert.equal(newReleaseStatus(['2026', '2026-10'], now), 'unknown', 'year/month only cannot prove "within 90 days"');
  assert.equal(newReleaseStatus(['garbage'], now), 'unknown');
  assert.equal(isNewRelease(['2026-10-01'], now), true);
  assert.equal(isNewRelease(['2026-11-30'], now), false, 'a future date is not a new release yet');
});

test('New Release uses the earliest dated edition, so a recent reprint of an old book is not new', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  assert.equal(newReleaseStatus(['2026-10-01', '1999-05-05'], now), 'no');
  assert.equal(newReleaseStatus(['2026-10-01', '2026'], now), 'new', 'a year-only edition is ignored, not trusted');
});

const row = (o: Partial<EditionFillRow> = {}): EditionFillRow => ({ publisher: null, publication_date: null, publication_year: null, page_count: null, language_code: null, format: null, ...o });

test('edition fill: empty columns are filled from the provider', () => {
  const r = planEditionFill(row(), { publisher: ' Penguin ', publishedDate: '2021-03-03', pages: 320, language: 'EN' });
  assert.deepEqual(r.patch, { publisher: 'Penguin', publication_date: '2021-03-03', publication_year: 2021, page_count: 320, language_code: 'en' });
  assert.deepEqual(r.conflicts, []);
});

test('edition fill: a filled column is never overwritten; a disagreement is reported', () => {
  const r = planEditionFill(row({ publisher: 'Tor', publication_year: 2019, page_count: 300, language_code: 'en' }), { publisher: 'Penguin', publishedDate: '2021', pages: 320, language: 'en' });
  assert.deepEqual(r.patch, { publication_date: '2021' }, 'only the empty date is filled');
  assert.equal(r.conflicts.length, 3);
  assert.ok(r.conflicts.every(c => /have/.test(c)));
});

test('edition fill: junk input writes nothing', () => {
  assert.deepEqual(planEditionFill(row(), { publishedDate: 'soon', pages: -4, language: 'english??', publisher: '  ' }), { patch: {}, conflicts: [] });
  assert.deepEqual(planEditionFill(row(), { pages: 99999 }).patch, {});
});
