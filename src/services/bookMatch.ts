export const normText = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function sameTitle(want: string, got: string): boolean {
  const expected = normText(want);
  const actual = normText(got);
  if (!expected || !actual) return false;
  if (expected === actual || expected.includes(actual) || actual.includes(expected)) return true;
  const expectedWords = new Set(expected.split(' ').filter(word => word.length > 2));
  const actualWords = actual.split(' ').filter(word => word.length > 2);
  if (!expectedWords.size || !actualWords.length) return false;
  return actualWords.filter(word => expectedWords.has(word)).length / Math.min(expectedWords.size, actualWords.length) >= 0.7;
}

const lastName = (full: string) => normText(full).split(' ').filter(Boolean).pop() || '';

export function sameAuthor(want: string, got: string | string[] | undefined): boolean {
  const expected = want.split(/,|&| and /i).map(lastName).filter(Boolean);
  if (!expected.length) return true;
  const actual = (Array.isArray(got) ? got : [got || ''])
    .flatMap(author => author.split(/,|&| and /i))
    .map(lastName)
    .filter(Boolean);
  return actual.some(author => expected.includes(author));
}

export const sameBook = (wantTitle: string, wantAuthor: string, gotTitle: string, gotAuthor: string | string[] | undefined) =>
  sameTitle(wantTitle, gotTitle) && sameAuthor(wantAuthor, gotAuthor);