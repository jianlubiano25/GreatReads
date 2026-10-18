// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACEHOLDER_STYLES, placeholderStyleFor, titleSizeCqw, isFrontCoverShape } from './placeholderCover';

test('there are six styles', () => assert.equal(PLACEHOLDER_STYLES.length, 6));

test('a book always gets the same style, whatever the letter case or spacing', () => {
  const a = placeholderStyleFor({ title: 'Dune', author: 'Frank Herbert' });
  const b = placeholderStyleFor({ title: '  DUNE ', author: 'frank herbert' });
  assert.equal(a.id, b.id);
});

test('styles are spread over all six colours', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 300; i++) seen.add(placeholderStyleFor({ title: `Book number ${i}`, author: `Author ${i}` }).id);
  assert.equal(seen.size, 6);
});

test('longer titles get smaller type, and a long single word still fits', () => {
  assert.ok(titleSizeCqw('Dune') > titleSizeCqw('The Girl with the Dragon Tattoo'));
  assert.ok(titleSizeCqw('The Girl with the Dragon Tattoo') > titleSizeCqw('A Brief History of Time: From the Big Bang to Black Holes and Beyond the Edge'));
  assert.ok(titleSizeCqw('Incomprehensibilities') < titleSizeCqw('Dune'));
  assert.ok(titleSizeCqw('x'.repeat(300)) >= 6.5);
});

test('front covers pass; spreads, box sets and wide photos do not', () => {
  assert.equal(isFrontCoverShape(200, 300), true);
  assert.equal(isFrontCoverShape(600, 900), true);
  assert.equal(isFrontCoverShape(438, 500), true); // Open Library scan of a squarish front (ratio ~0.876), e.g. "How to Win at Chess"
  assert.equal(isFrontCoverShape(460, 500), true); // ratio 0.92: the upper limit
  assert.equal(isFrontCoverShape(480, 500), false); // ratio 0.96: square-ish, not a front
  assert.equal(isFrontCoverShape(1200, 1000), false); // spread, ratio 1.2
  assert.equal(isFrontCoverShape(1000, 700), false); // front + spine + back
  assert.equal(isFrontCoverShape(500, 500), false); // square photo of a book
  assert.equal(isFrontCoverShape(0, 0), true); // unknown
});

test('title type is about 20% larger than before in each length band, and the whole title still fits above the author', async () => {
  const { titleLines, TITLE_SCALE } = await import('./placeholderCover');
  assert.equal(TITLE_SCALE, 1.2);
  assert.equal(titleSizeCqw('Dune'), 23 * 1.2 > 78 / (4 * 0.62) ? 78 / (4 * 0.62) : 23 * 1.2); // short title: the larger band size, unless one line cannot hold it
  const titles = ['Dune', 'It', 'The Girl with the Dragon Tattoo', 'A Brief History of Time: From the Big Bang to Black Holes', 'Harry Potter and the Chamber of Secrets', 'x '.repeat(60).trim(), 'Incomprehensibilities and other disquieting words'];
  for (const t of titles) {
    const size = titleSizeCqw(t);
    assert.ok(size >= 6.5, t);
    // 150 (cover height) - 17 (padding) - 27 (author reserve), in % of the width
    assert.ok(titleLines(t, size) * size * 1.08 <= 106 || size === 6.5, `"${t}" at ${size} takes ${titleLines(t, size)} lines`);
  }
  assert.ok(titleSizeCqw('The Girl with the Dragon Tattoo') >= 15, 'a mid-length title is not smaller than before');
});
