/**
 * Raised when the importer makes different chapters or paragraphs from the same file, so the books it can fetch again (the
 * Mac's books and the classics) are imported again (ui/library/upgrade.ts). Its own module so the library can read it without
 * loading the importers. 2: long chapters kept whole, paragraphs broken mid-sentence joined, small-form and ASCII
 * punctuation set full-width, short numbered sections kept in one chapter.
 */
export const IMPORT_VERSION = 2;
