import React from 'react';

/**
 * A tab's content stays mounted once it has been opened and is only hidden when you switch away,
 * so covers, shelves and scroll positions are not rebuilt (or re-downloaded) every time you come back.
 * Tabs you never open cost nothing: they are not rendered until the first visit.
 */
export function TabPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div hidden={!active} className="contents">{children}</div>;
}
