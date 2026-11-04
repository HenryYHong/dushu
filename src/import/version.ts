/**
 * Raised when the importer makes different chapters or paragraphs from the same file, so the books it can fetch again (the
 * Mac's books and the classics) are imported again (ui/library/upgrade.ts). Its own module so the library can read it without
 * loading the importers. 2: long chapters kept whole, paragraphs broken mid-sentence joined, small-form and ASCII
 * punctuation set full-width, short numbered sections kept in one chapter. Later importer fixes (a paragraph that starts
 * with a closing mark joins the one before, a one-chapter text is titled by its own first heading, classical section titles
 * and poem titles over verse are headings) apply to new imports only: they are cosmetic, and raising the version would
 * re-import the owner's Mac books and move every reading place to new sync keys. 3: a book set out one printed line per <p>
 * (blank <p>s between its paragraphs) and hard-wrapped has its lines joined back into paragraphs (blocks.ts), which changes the
 * paragraphs of such a book. The fixes for damaged and odd files that followed (UTF-8 with bad bytes, radicals from Mac PDFs,
 * more heading styles, ads cut off story lines, exact hard wraps, Big5-HKSCS, ciphertext EPUBs, watermarked scans) did not raise
 * it: the owner's books and every classic import exactly as before with them, so only new imports change.
 */
export const IMPORT_VERSION = 3;
