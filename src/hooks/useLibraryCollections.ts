import { useCallback, useState } from 'react';
import { loadCollections, saveCollections, type Collection } from '../services/libraryCollections';

/** Your shelves and tags, shared by the My Library tab and the "Add to My Library" sheet, and kept on this device. */
export function useLibraryCollections() {
  const [collections, setCollections] = useState<Collection[]>(() => loadCollections());
  const update = useCallback((change: (prev: Collection[]) => Collection[]) => {
    setCollections(prev => {
      const next = change(prev);
      if (next !== prev) saveCollections(next);
      return next;
    });
  }, []);
  /** Read them again from the device (after a backup restore or a duplicate merge changed them) */
  const reload = useCallback(() => setCollections(loadCollections()), []);
  return { collections, update, reload };
}
