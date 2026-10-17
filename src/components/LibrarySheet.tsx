import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Book, BookStatus } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';
import type { Collection } from '../services/libraryCollections';

export const STATUS_CHOICES: Array<{ key: BookStatus; label: string }> = [
  { key: 'now', label: 'Reading now' },
  { key: 'next', label: 'Up next' },
  { key: 'done', label: 'Finished' },
  { key: 'dnf', label: 'Did not finish' },
  { key: 'skip', label: 'Not for me' },
  { key: 'list', label: 'No status' },
];

interface Props {
  book: Book;
  inLibrary: boolean;
  /** Where the book is now ('list' = no status; also what a new book starts as) */
  status: BookStatus;
  shelves: Collection[];
  tags: Collection[];
  /** Ids of the shelves and tags the book is on now */
  checked: string[];
  /** Makes a new shelf or tag and returns its id (null when the name is empty) */
  onCreate: (kind: Collection['kind'], name: string) => string | null;
  onApply: (value: { status: BookStatus; chosen: string[] }) => void;
  /** Take the book out of My Library (only offered for a book that is in it). The app asks "are you sure?" */
  onRemove?: () => void;
  onClose: () => void;
}

const LINE = 'border-[#e3d7c3] dark:border-[#382f25]';
const MUTED = 'text-[#706256] dark:text-[#a89a8a]';

/** "Add to My Library": where the book is in your reading, which shelves it is on, and its tags. */
export function LibrarySheet({ book, inLibrary, status: initialStatus, shelves, tags, checked, onCreate, onApply, onRemove, onClose }: Props) {
  useModalA11y(onClose);
  const [status, setStatus] = useState<BookStatus>(initialStatus);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(checked));
  const [adding, setAdding] = useState<null | Collection['kind']>(null);
  const [name, setName] = useState('');

  const toggle = (id: string) =>
    setChosen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = () => {
    if (!adding) return;
    const id = onCreate(adding, name);
    if (id) setChosen(prev => new Set(prev).add(id));
    setAdding(null);
    setName('');
  };

  const group = (kind: Collection['kind'], title: string, list: Collection[], emptyText: string) => (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h4 className={`text-xs font-bold uppercase tracking-wider ${MUTED}`}>{title}</h4>
      {list.length === 0 && adding !== kind && <p className={`text-xs ${MUTED}`}>{emptyText}</p>}
      <ul className="flex flex-col">
        {list.map(c => {
          const on = chosen.has(c.id);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => toggle(c.id)} aria-pressed={on} className="w-full min-h-[44px] flex items-center gap-3 text-left">
                <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-[#2e5934] border-[#2e5934] text-white' : LINE}`}>
                  {on && <Check className="w-3.5 h-3.5" />}
                </span>
                <span className="text-sm">{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {adding === kind ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') create(); }}
            maxLength={40}
            placeholder={kind === 'shelf' ? 'Shelf name' : 'Tag name'}
            aria-label={`New ${kind} name`}
            className={`flex-1 py-2 px-3 rounded-xl text-sm bg-[#f5f0e6] dark:bg-[#181410] border ${LINE} focus:outline-none focus:border-[#2e5934]`}
          />
          <button type="button" onClick={create} disabled={!name.trim()} className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#2e5934] text-white disabled:opacity-40">Create</button>
          <button type="button" onClick={() => { setAdding(null); setName(''); }} className={`px-2 py-2 text-xs font-semibold ${MUTED}`}>Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => { setAdding(kind); setName(''); }} className="self-start min-h-[40px] flex items-center gap-1.5 text-sm font-semibold text-[#2e5934] dark:text-[#86b880]">
          <Plus className="w-4 h-4" />
          New {kind}…
        </button>
      )}
    </section>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to My Library"
        className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-[#fdfaf5] dark:bg-[#1f1914] text-[#2c241b] dark:text-[#f0e8dc] rounded-t-3xl sm:rounded-3xl shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <h3 className="text-base font-semibold">{inLibrary ? 'In My Library' : 'Add to My Library'}</h3>
          <p className={`text-xs mt-0.5 line-clamp-1 ${MUTED}`}>{book.title}</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 flex flex-col gap-5 pb-4">
          <section className="flex flex-col gap-2" aria-label="Reading status">
            <h4 className={`text-xs font-bold uppercase tracking-wider ${MUTED}`}>Reading status</h4>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reading status">
              {STATUS_CHOICES.map(c => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={status === c.key}
                  onClick={() => setStatus(c.key)}
                  className={`min-h-[40px] px-3.5 rounded-full border text-xs font-semibold transition-all ${status === c.key ? 'bg-[#2e5934] text-white border-[#2e5934]' : `${LINE} ${MUTED} hover:text-[#201a15]`}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </section>
          {group('shelf', 'Shelves', shelves, 'You have no shelves yet.')}
          {group('tag', 'Tags', tags, 'You have no tags yet.')}
        </div>

        <div className={`shrink-0 px-5 py-4 border-t ${LINE} pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2`}>
          {inLibrary && onRemove && (
            <button type="button" onClick={onRemove} className="mr-auto min-h-[40px] px-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline" aria-label={`Remove ${book.title} from My Library`}>
              <Trash2 className="w-4 h-4" />
              Remove
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className={`px-4 py-2 rounded-xl text-xs font-semibold ${MUTED}`}>Cancel</button>
            <button
              type="button"
              onClick={() => onApply({ status, chosen: [...chosen] })}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729]"
            >
              {inLibrary ? 'Save' : 'Add to My Library'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
