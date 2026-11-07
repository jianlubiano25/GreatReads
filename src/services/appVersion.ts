import { formatVersion } from './versionString';

declare const __APP_VERSION__: string;
/** `GreatReads 0.1.<build>.<short-sha>.<branch>`, made at build time (see versionString.ts). A dev server shows `GreatReads 0.1.0.dev.dev`. */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : formatVersion({ build: 0, sha: '', branch: 'dev' }).replace('nosha', 'dev');
