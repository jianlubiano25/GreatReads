/**
 * Where a description or author bio came from (D7 step 5). The app shows one text per book, so when Book Info finds one it notes the provider here;
 * Save to catalog and capture then store that provider as the source (with its link) instead of the generic "app". Text with no note stays "app".
 * Names match the rating sources: google_books, apple_books, open_library, hardcover; an author bio from Wikipedia is "wikipedia".
 */
export interface TextSource { name: string; url?: string }
const memo = new Map<string, TextSource>();
const key = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 400).toLowerCase();

export function noteTextSource(text: string, name: string, url?: string): void {
  const k = key(text);
  if (!k) return;
  memo.set(k, { name, ...(url ? { url } : {}) });
  while (memo.size > 400) memo.delete(memo.keys().next().value as string);
}
export const textSourceOf = (text: string): TextSource => memo.get(key(text)) ?? { name: 'app' };
export const forgetTextSourcesForTests = () => memo.clear();
