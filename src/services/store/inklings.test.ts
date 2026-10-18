// Tests the Inklings Book Club reader (functions/api/inklings.js), the Nobel laureate table reader and the new refresh specs.
//
// FIXTURES: the episode titles, tags and description sentences below are the ones the club's podcast showed in public listings
// (Listen Notes, Audible, iHeart) in Oct 2026; the RSS markup is a reconstruction of a Megaphone feed. `npm run check:shelves`
// exercises the live feed on a deployed site.
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module with no type declarations
import { parseInklings } from '../../../functions/api/inklings.js';
import { DYNAMIC_SPECS, dynamicInfo, nobelLaureates } from './dynamic';
import { parseWikiTables } from './wikiLists';
import { CURATED_SHELVES } from '../../data/storeCatalog';

const item = (title: string, date: string, desc = 'Learn more about your ad choices. Visit megaphone.fm/adchoices') =>
  `<item><title><![CDATA[${title}]]></title><description><![CDATA[<p>${desc}</p>]]></description><pubDate>${date}</pubDate></item>`;

const FEED = `<?xml version="1.0"?><rss><channel><title>Inklings Book Club</title><description>The internet's resident librarian...</description>
${item('Ocean Vuong: The Emperor of Gladness', 'Mon, 20 Jul 2026 05:00:00 +0000', 'Hello and welcome back to the Inklings Book Club podcast – this month our book club picks as The Emperor of Gladness and today we’re joined by Ocean Vuong.')}
${item('Douglas Stuart: John of John', 'Fri, 17 Jul 2026 05:00:00 +0000', 'This episode was recorded live at Union Chapel so it is audio-only.')}
${item('Lily King: Heart The Lover', 'Fri, 19 Jun 2026 05:00:00 +0000', 'Welcome to a mini series where we meet the six shortlisted authors for the Women’s Prize for Fiction!')}
${item('Kaveh Akbar: Martyr!', 'Sat, 11 Apr 2026 05:00:00 +0000', 'Hello and welcome back to the Inklings Book Club podcast and our March book of the month!!! This month we read Martyr! By Kaveh Akbar.')}
${item('Mary Shelley: Frankenstein [Book Club]', 'Tue, 28 Oct 2025 05:00:00 +0000')}
${item('Yasmin Zaher: The Coin *BOOK CLUB*', 'Mon, 20 Oct 2025 05:00:00 +0000')}
${item('Oisín McKenna: Evenings and Weekends *BOOK CLUB*', 'Mon, 20 Oct 2025 04:00:00 +0000', 'in this inaugural Inklings Book Club meeting.')}
${item('Greg James: All The Best For The Future', 'Thu, 7 May 2026 05:00:00 +0000', 'Greg James has been a presenter for BBC Radio 1 since 2007.')}
${item('A pick with no author in the title', 'Mon, 1 Jun 2026 05:00:00 +0000', 'our book of the month')}
</channel></rss>`;

test('only the episodes that say they are the club pick count, as "Author: Book", newest first, each with its month', () => {
  const picks = parseInklings(FEED);
  assert.deepEqual(picks.map((p: any) => `${p.author} | ${p.title} | ${p.when}`), [
    'Ocean Vuong | The Emperor of Gladness | Jul 2026',
    'Kaveh Akbar | Martyr! | Apr 2026',
    'Mary Shelley | Frankenstein | Oct 2025',
    'Yasmin Zaher | The Coin | Oct 2025',
    'Oisín McKenna | Evenings and Weekends | Oct 2025',
  ]);
});

test('an interview, a prize series episode or a feed with no picks gives nothing (so the shelf keeps its saved list)', () => {
  assert.deepEqual(parseInklings(FEED.replace(/<item>[\s\S]*<\/item>/, item('Greg James: All The Best', 'Thu, 7 May 2026 05:00:00 +0000'))), []);
  assert.deepEqual(parseInklings('not a feed'), []);
});

test('the Inklings Book Club shelf appends from the podcast feed; the original Inklings stay hand-picked', () => {
  const sp = DYNAMIC_SPECS.inklingsclub;
  assert.equal(sp.merge, 'append');
  assert.equal(sp.keepExisting, true);
  assert.equal(sp.handle, 'feeds.megaphone.fm/inklings');
  const info = dynamicInfo(CURATED_SHELVES.find(s => s.id === 'inklingsclub')!, sp);
  assert.match(info.source, /podcast feed/);
  assert.equal(info.handle, 'feeds.megaphone.fm/inklings');
  assert.equal(DYNAMIC_SPECS.inklings, undefined);
});

const NOBEL = `{| class="wikitable sortable"
! Year !! Image !! Laureate !! Country !! Language(s) !! Citation
${Array.from({ length: 25 }, (_, i) => `|-\n| ${2026 - i} || [[File:x.jpg]] || [[Name${i} Writer]] || Somewhere || English || for something`).join('\n')}
|-
| 2025 || x || [[László Krasznahorkai]] || Hungary || Hungarian || for his compelling work
|}`;

test('Nobel laureates come from the table by header, newest first, one per row', () => {
  const l = nobelLaureates(parseWikiTables(NOBEL));
  assert.equal(l[0].year, 2026);
  assert.equal(l[0].name, 'Name0 Writer');
  assert.ok(l.every((x, i) => i === 0 || l[i - 1].year >= x.year));
  assert.deepEqual(nobelLaureates(parseWikiTables('{| class="wikitable"\n! Year !! Laureate\n|-\n| 2026 || A B\n|}')), [], 'a small table is not the laureates table');
});

test('Nobel, Top Fiction and Top Non-fiction now refresh themselves; Nobel says the book is GreatReads\' choice', () => {
  assert.equal(DYNAMIC_SPECS.nobel.merge, 'append');
  assert.match(DYNAMIC_SPECS.nobel.source, /GreatReads' choice/);
  assert.equal(DYNAMIC_SPECS.topfiction.kind, 'generated');
  assert.equal(DYNAMIC_SPECS.topnonfiction.kind, 'generated');
  for (const id of ['nobel', 'topfiction', 'topnonfiction']) assert.ok(CURATED_SHELVES.some(s => s.id === id), id);
});

/* ------------------------------ Nobel (official API + Wikipedia) and Goodreads Choice ------------------------------ */
// @ts-ignore plain JS modules with no type declarations
import { parseNobel } from '../../../functions/api/nobel.js';
// @ts-ignore
import { newestYear, parseChoiceWinners } from '../../../functions/api/goodreads-choice.js';

test('the Nobel Foundation API answer gives the literature laureates, newest first (other prizes and org names ignored)', () => {
  const l = parseNobel({ laureates: [
    { knownName: { en: 'Han Kang' }, nobelPrizes: [{ awardYear: '2024', category: { en: 'Literature' } }] },
    { knownName: { en: 'Anne Carson' }, nobelPrizes: [{ awardYear: '2026', category: { en: 'Literature' } }] },
    { knownName: { en: 'Marie Curie' }, nobelPrizes: [{ awardYear: '1903', category: { en: 'Physics' } }, { awardYear: '1911', category: { en: 'Chemistry' } }] },
    { fullName: { en: 'Louise Glück' }, nobelPrizes: [{ awardYear: '2020', category: { en: 'Literature' } }] },
  ] });
  assert.deepEqual(l, [{ year: 2026, name: 'Anne Carson' }, { year: 2024, name: 'Han Kang' }, { year: 2020, name: 'Louise Glück' }]);
  assert.deepEqual(parseNobel({}), []);
});

// Wikipedia heads TWO columns "Laureate" (a picture, then the name): the first one is empty, which is why the table was read as empty
const NOBEL_2ROW = `{| class="wikitable"
! rowspan=2 | Year !! colspan=2 | Laureate !! rowspan=2 | Country & Language !! rowspan=2 | Citation
|-
! Image !! Name
${Array.from({ length: 25 }, (_, i) => `|-\n| ${2025 - i} || [[File:x.jpg|100px]] || [[Writer ${i}]] (1950–) || Somewhere (English) || "for something"`).join('\n')}
|}`;

test('Wikipedia\'s two-row Laureate header: the name column is the right one, not the picture column', () => {
  const l = nobelLaureates(parseWikiTables(NOBEL_2ROW));
  assert.equal(l.length, 25);
  assert.deepEqual(l[0], { year: 2025, name: 'Writer 0' });
});

const AWARD_PAGE = `<a href="/choiceawards/best-books-2025">See all</a> <a href="/choiceawards/best-books-2024">2024 winners</a> <a href="/choiceawards/best-books-2023">2023</a>`;
const winner = (cat: string, alt: string) => `<div class="category clearFix"><a href="/x"><h4 class="category__copy">${cat}</h4><img alt="${alt}" class="category__winnerImage" src="x.jpg"></a></div>`;
const CHOICE_PAGE = ['Best Fiction|My Friends by Fredrik Backman', 'Best Historical Fiction|Atmosphere by Taylor Jenkins Reid', 'Best Romantasy|Onyx Storm by Rebecca Yarros', 'Best Nonfiction|Everything Is Tuberculosis by John Green']
  .map(x => { const [c, a] = x.split('|'); return winner(c, a); }).join('\n');

test('Goodreads: the newest year the awards page links to, and the winners with their category', () => {
  assert.equal(newestYear(AWARD_PAGE), 2025);
  assert.equal(newestYear(AWARD_PAGE + '<a href="/choiceawards/best-books-2026">2026</a>'), 2026, 'a new year is picked up by itself');
  assert.equal(newestYear('nothing'), 0);
  assert.deepEqual(parseChoiceWinners(CHOICE_PAGE), [
    { title: 'My Friends', author: 'Fredrik Backman', category: 'Fiction' },
    { title: 'Atmosphere', author: 'Taylor Jenkins Reid', category: 'Historical Fiction' },
    { title: 'Onyx Storm', author: 'Rebecca Yarros', category: 'Romantasy' },
    { title: 'Everything Is Tuberculosis', author: 'John Green', category: 'Nonfiction' },
  ]);
  assert.deepEqual(parseChoiceWinners('<html>blocked</html>'), []);
});

test('the Goodreads shelf replaces the old year with the newest one (not an append) and says where it reads from', () => {
  const sp = DYNAMIC_SPECS.goodreadschoice;
  assert.equal(sp.merge, undefined);
  assert.equal(sp.kind, 'official');
  assert.match(sp.handle!, /goodreads\.com\/award/);
});

/* ------------------------------ one primary honor on a Store cover; every shelf the same height ------------------------------ */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { primaryAward, AwardBadges } from '../../components/BookMeta';

const bk = (o: any) => ({ id: 'x', title: 'T', author: 'A', ...o });

test('a Store cover wears ONE honor: its own shelf\'s label first, else the best one (a win beats a shortlist beats a club pick)', () => {
  assert.equal(primaryAward(bk({ awardLabel: 'Booker Prize 2025' }))!.label, 'Booker Prize 2025');
  assert.equal(primaryAward(bk({}))?.label, undefined, 'no honor, no chip');
  const html = renderToStaticMarkup(React.createElement(AwardBadges, { book: bk({ awardLabel: 'Booker Prize 2025' }), primary: true } as any));
  assert.equal((html.match(/rl-bdg /g) || []).length, 1);
  assert.match(html, /truncate/, 'one line, so every shelf keeps the same height');
  assert.equal(renderToStaticMarkup(React.createElement(AwardBadges, { book: bk({}), primary: true } as any)), '');
});

test('the library cards and book info still list every honor (primary is only for the Store covers)', () => {
  const html = renderToStaticMarkup(React.createElement(AwardBadges, { book: bk({ awardLabel: 'Pulitzer Prize 2024' }) } as any));
  assert.match(html, /Pulitzer Prize 2024/);
});
