/**
 * One shared, counted lock on page scrolling. Full-screen search and every modal lock the page; each used to remember "the overflow before me" on its own,
 * so closing them in the other order (search closed while a book's details were open) restored a stale 'hidden' and no tab could scroll again.
 * Here the first lock saves the real value and the last release puts it back, whatever order they are released in.
 */
let locks = 0;
let saved = '';

/** Lock page scrolling; call the returned function (once) to release. Safe to call from several places at the same time. */
export function lockBodyScroll(): () => void {
  if (locks++ === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = saved;
  };
}
