/**
 * Raised when the importer makes different chapters or paragraphs from the same file, so the books it can fetch again (the
 * Mac's books and the classics) are imported again (ui/library/upgrade.ts). Its own module so the library can read it without
 * loading the importers. 2: long chapters kept whole, paragraphs broken mid-sentence joined, small-form and ASCII
 * punctuation set full-width, short numbered sections kept in one chapter. Later importer fixes (a paragraph that starts
 * with a closing mark joins the one before, a one-chapter text is titled by its own first heading, classical section titles
 * and poem titles over verse are headings) apply to new imports only: they are cosmetic, and raising the version would
 * re-import the owner's Mac books and move every reading place to new sync keys.
 */
export const IMPORT_VERSION = 2;
