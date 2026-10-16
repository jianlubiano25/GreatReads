import { useMemo, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import type { Book } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import type { Collection } from '../services/libraryCollections';

interface Props {
  /** The tag or shelf being made (id is filled in when saved) or changed */
  initial: Pick<Collection, 'kind' | 'name' | 'bookIds'> & { id?: string };
  /** Every book in the Library: these are the ones you can put in */
  books: Book[];
  onSave: (value: { id?: string; kind: Collection['kind']; name: string; bookIds: string[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Name a tag or shelf and tick the Library books that belong in it. */
export function LibraryCollectionModal({ initial, books, onSave, onDelete, onClose }: Props) {
  useModalA11y(onClose);
  const [name, setName] = useState(initial.name);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.bookIds));
  const sorted = useMemo(() => books.slice().sort((a, b) => a.title.localeCompare(b.title)), [books]);
  const label = initial.kind === 'shelf' ? 'shelf' : 'tag';
  const trimmed = name.trim();

  const toggle = (id: string) =>
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-[500px] max-h-[85vh] bg-[#fbf7ee] dark:bg-[#231d17] text-[#201a15] dark:text-[#f0e6d6] rounded-3xl shadow-2xl border border-[#e3d7c3] dark:border-[#382f25] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${initial.id ? 'Edit' : 'New'} ${label}`}
      >
        <div className="px-6 py-4 border-b border-[#e3d7c3] dark:border-[#382f25] flex items-center justify-between">
          <h3 className="font-serif-display text-xl">{initial.id ? `Edit ${label}` : `New ${label}`}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4 flex flex-col gap-3 min-h-0">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={40}
            placeholder={initial.kind === 'shelf' ? 'Shelf name, e.g. Cozy winter reads' : 'Tag name, e.g. Book club'}
            aria-label={`${label} name`}
            className="w-full py-2 px-3 rounded-xl text-sm bg-[#f5f0e6] dark:bg-[#181410] border border-[#e3d7c3] dark:border-[#382f25] focus:outline-none focus:border-[#2e5934]"
          />
          <p className="text-xs text-[#706256] dark:text-[#a89a8a]">Tick the books in your Library that belong here ({picked.size} chosen).</p>
        </div>

        <ul className="px-6 py-2 overflow-y-auto min-h-0 flex-1">
          {sorted.length === 0 && <li className="py-3 text-sm text-[#706256] dark:text-[#a89a8a]">Your Library has no books yet. You can add some later.</li>}
          {sorted.map(b => {
            const id = String(b.id);
            const on = picked.has(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-pressed={on}
                  className="w-full flex items-center gap-3 py-2 text-left"
                >
                  <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-[#2e5934] border-[#2e5934] text-white' : 'border-[#e3d7c3] dark:border-[#382f25]'}`}>
                    {on && <Check className="w-3.5 h-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{b.title}</span>
                    <span className="block text-[11px] text-[#706256] dark:text-[#a89a8a] truncate">{b.author}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-6 py-4 border-t border-[#e3d7c3] dark:border-[#382f25] flex items-center gap-2">
          {initial.id && onDelete && (
            <button type="button" onClick={onDelete} className="p-2 rounded-xl text-[#706256] hover:text-red-500" aria-label={`Delete ${label}`} title={`Delete ${label} (your books stay in the Library)`}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-[#706256] dark:text-[#a89a8a]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => onSave({ id: initial.id, kind: initial.kind, name: trimmed, bookIds: [...picked] })}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
