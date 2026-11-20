/**
 * The version text a person can read out or paste: `GreatReads 0.1.<build>.<short-sha>.<branch>`.
 *  - build: a counter kept in the file BUILD_NUMBER at the project root, raised by one with every push (so two pastes can be put in order);
 *  - short-sha: the first 7 characters of the commit the app was built from;
 *  - branch: a short code (bovci = claude/best-of-vscode-catalog-ids, jl2 = Jldata2, main = main; any other branch is shortened to its own letters).
 * Pure functions only: vite.config.ts builds the text at build time, Profile and Copy diagnostics show it.
 */
export const BRANCH_CODES: Record<string, string> = {
  'claude/best-of-vscode-catalog-ids': 'bovci',
  jldata2: 'jl2',
  main: 'main',
};

export function branchCode(branch: string | undefined): string {
  const b = (branch || '').trim().replace(/^refs\/heads\//, '');
  if (!b) return 'nobranch';
  const known = BRANCH_CODES[b] ?? BRANCH_CODES[b.toLowerCase()];
  if (known) return known;
  return b.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'branch';
}

export function formatVersion(p: { build?: string | number; sha?: string; branch?: string }): string {
  const build = String(p.build ?? '').trim().match(/^\d+$/) ? String(p.build).trim() : '0';
  const sha = (p.sha || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 7) || 'nosha';
  return `GreatReads 0.1.${build}.${sha}.${branchCode(p.branch)}`;
}
