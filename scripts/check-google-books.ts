/**
 * Checks that the Google Books API works for you, and that it really has (or lacks) a rating for a book.
 *
 *   GOOGLE_BOOKS_API_KEY=your-key npm run check:google            (the book defaults to Dune)
 *   GOOGLE_BOOKS_API_KEY=your-key npm run check:google -- "Piranesi" "Susanna Clarke"
 *
 * It asks Google twice, WITH and WITHOUT the key, and prints the HTTP status, Google's own reason for a refusal, and whether the volume has an
 * averageRating + ratingsCount. The key itself is never printed. Run it from the same kind of place the prefetch runs (your computer, or the
 * GitHub Action): a key restricted to your website's address (HTTP referrer) is refused when it is used from there, which looks exactly like
 * "Google has no ratings".
 */
const key = process.env.GOOGLE_BOOKS_API_KEY || process.env.VITE_GOOGLE_BOOKS_API_KEY || '';
const [title = 'Dune', author = 'Frank Herbert'] = process.argv.slice(2);
const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:"${title}" inauthor:"${author}"`)}&maxResults=20&printType=books&fields=${encodeURIComponent('items(id,volumeInfo(title,authors,averageRating,ratingsCount))')}`;

async function ask(label: string, withKey: boolean) {
  try {
    const res = await fetch(withKey ? `${url}&key=${encodeURIComponent(key)}` : url);
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      const e = body?.error;
      console.log(`${label}: HTTP ${res.status} ${e?.status || ''} - ${e?.errors?.[0]?.reason || ''} ${e?.message || ''}`.trim());
      return;
    }
    const items: any[] = body?.items || [];
    const rated = items.filter(i => i.volumeInfo?.averageRating && i.volumeInfo?.ratingsCount > 0);
    console.log(`${label}: HTTP ${res.status}, ${items.length} volumes, ${rated.length} with a rating`);
    for (const i of rated.slice(0, 3)) console.log(`   ${i.volumeInfo.title} - ${i.volumeInfo.averageRating} (${i.volumeInfo.ratingsCount} ratings)`);
    if (items.length && !rated.length) console.log('   Google answered fine: it simply has no rating for these editions (nothing to fix).');
  } catch (e: any) {
    console.log(`${label}: no answer (${e?.message || e})`);
  }
}

console.log(`Book: ${title} / ${author}.  Key set: ${key ? 'yes' : 'NO'}`);
if (key) await ask('with your key   ', true);
await ask('without the key', false);
console.log('\nReading the result:');
console.log(' - with key 403 / API_KEY_HTTP_REFERRER_BLOCKED or API_KEY_SERVICE_BLOCKED: the key is restricted (website address, or the Books API is not enabled for it).');
console.log(' - with key 400: the key is wrong or mistyped.');
console.log(' - 429 / rateLimitExceeded or quota: too many requests (the shared anonymous quota is often used up); the key raises it.');
console.log(' - 200 with 0 rated: Google has no rating for that book. That is Google\'s data, not a bug.');
