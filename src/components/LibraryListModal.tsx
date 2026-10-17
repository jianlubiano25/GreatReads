import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Book } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';

interface Props {
  title: string;
  books: Book[];
  renderCard: (b: Book) => ReactNode;
  onClose: () => void;
}

/** "View all": one whole list (Reading now, Finished, Up next...) on its own screen, scrolling down. */
export function LibraryListModal({ title, books, renderCard, onClose }: Props) {
  useModalA11y(onClose);
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))] px-5 pb-3 flex items-center justify-between border-b border-[#e3d7c3] dark:border-[#382f25]">
        <h2 className="font-serif-display text-2xl">
          {title} <span className="font-sans text-sm font-medium text-[#706256] dark:text-[#a89a8a]">{books.length}</span>
        </h2>
        <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          {books.map(b => (
            <div key={b.id} className="flex flex-col [&>*]:flex-1" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}>
              {renderCard(b)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
