// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const body = { style: { overflow: '' } };
(globalThis as any).document = { body };

import { lockBodyScroll } from './bodyScrollLock';

test('page scrolling comes back whichever order search and a modal release the lock in', () => {
  const search = lockBodyScroll(); // full-screen results open
  assert.equal(body.style.overflow, 'hidden');
  const modal = lockBodyScroll(); // View Details opens over them
  search(); // the reader closes the search first
  assert.equal(body.style.overflow, 'hidden', 'still locked: the modal is open');
  modal(); // then closes the details
  assert.equal(body.style.overflow, '', 'every tab can scroll again');
});

test('releasing twice does not unlock someone else\'s lock, and the original value is restored', () => {
  body.style.overflow = 'auto';
  const a = lockBodyScroll();
  const b = lockBodyScroll();
  a(); a();
  assert.equal(body.style.overflow, 'hidden');
  b();
  assert.equal(body.style.overflow, 'auto');
});
