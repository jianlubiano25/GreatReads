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
  assert.ok(titleSizeCqw('x'.repeat(300)) >= 6);
});

test('front covers pass; spreads, box sets and wide photos do not', () => {
  assert.equal(isFrontCoverShape(200, 300), true);
  assert.equal(isFrontCoverShape(600, 900), true);
  assert.equal(isFrontCoverShape(1000, 700), false); // front + spine + back
  assert.equal(isFrontCoverShape(500, 500), false); // square photo of a book
  assert.equal(isFrontCoverShape(0, 0), true); // unknown
});
