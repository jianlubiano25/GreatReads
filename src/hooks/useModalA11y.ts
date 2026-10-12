import { useEffect, useRef } from 'react';

const escapeStack: Array<() => void> = [];
let openModals = 0;
let previousBodyOverflow = '';

export function useModalA11y(onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = () => closeRef.current();
    escapeStack.push(close);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || escapeStack.at(-1) !== close) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);

    // Keep Tab inside the top-most dialog so it can't reach the page behind
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || escapeStack.at(-1) !== close) return;
      const all = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      const top = all[all.length - 1];
      if (!top) return;
      const items = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); top.focus({ preventScroll: true }); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!top.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (active === first || active === top)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab);

    if (openModals++ === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const dialog = dialogs[dialogs.length - 1];
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.tabIndex = -1;
      dialog.focus({ preventScroll: true });
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onTab);
      const index = escapeStack.lastIndexOf(close);
      if (index >= 0) escapeStack.splice(index, 1);
      if (--openModals === 0) document.body.style.overflow = previousBodyOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
}