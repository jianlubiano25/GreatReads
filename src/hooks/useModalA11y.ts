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
      const index = escapeStack.lastIndexOf(close);
      if (index >= 0) escapeStack.splice(index, 1);
      if (--openModals === 0) document.body.style.overflow = previousBodyOverflow;
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
}