import { X } from 'lucide-react';

/**
 * The "x" inside a search box: clears what was typed. Shown only while there is text. It does not take focus from the box
 * (so the keyboard stays up on iPhone / iPad); the owner puts the cursor back after clearing.
 */
export function ClearButton({ show, onClear, label = 'Clear search' }: { show: boolean; onClear: () => void; label?: string }) {
  if (!show) return null;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={e => e.preventDefault()}
      onClick={onClear}
      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[#706256] dark:text-[#a89a8a] hover:bg-[#e3d7c3] dark:hover:bg-[#382f25] transition-colors"
    >
      <X className="w-4 h-4" />
    </button>
  );
}
