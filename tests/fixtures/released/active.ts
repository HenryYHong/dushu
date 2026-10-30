// lang/active.ts's syncsHere as main (ff6ab6c) had it, for the frozen cloudBooks.ts beside it: only Chinese synced, since
// OTHER_LANGUAGES_SYNC was false. The language is the current page's (setLangForTests in a test).
import { isChinese } from '../../../src/lang/active';

export const syncsHere = (): boolean => isChinese();
