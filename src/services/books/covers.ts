/**
 * COVERS: everything about a book's cover, split into modules (no change in behaviour):
 *   coverAnalysis    link quality, flat-vs-render pictures (pixels / inspectCover / readCover), probeImage, coverKey
 *   coverCandidates  the covers a book has: the three sources, their ranking (English first), the candidate cache
 *   coverLookup      finding / repairing / showing a cover: resolveCover, fixes, settled marks, refresh buttons
 *   coverPicks       your picks, the published set, publishing, owner mode
 * Everything is re-exported from here, so existing imports keep working.
 */
export * from './coverAnalysis';
export * from './coverCandidates';
export * from './coverLookup';
export * from './coverPicks';
export * from './bookView';
