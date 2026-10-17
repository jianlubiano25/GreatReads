import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLE_SHELVES, chartBooks } from './appleShelves';
import type { AppleChartEntry } from '../books/sources/appleCharts';

const entry = (rank: number, title: string, genres: string[] = ['Fiction & Literature']): AppleChartEntry =>
  ({ rank, total: 5, chart: 'top-free', id: `t${rank}`, title, author: `Author ${rank}`, genres, cover: '' });

test('Apple chart shelves keep Apple\'s order, skip books the app keeps out of every shelf, and stop at the limit', () => {
  const entries = [entry(1, 'The Quiet Garden'), entry(2, 'Hot Nights', ['Erotica']), entry(3, 'River Songs'), entry(4, 'Paper Moons'), entry(5, 'Last Light')];
  const books = chartBooks(entries, 3);
  assert.deepEqual(books.map(b => b.title), ['The Quiet Garden', 'River Songs', 'Paper Moons']);
  assert.ok(books.every(b => b.source === 'apple'));
  assert.deepEqual(APPLE_SHELVES.map(s => s.chart), ['top-free', 'top-paid', 'audio-top-free', 'audio-top-paid']);
});
