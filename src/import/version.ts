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
 * it: the owner's books and every classic import exactly as before with them, so only new imports change. 4: Project Gutenberg
 * books and others like them are cut differently (spine.ts, epub.ts, blocks.ts, chapters.ts): printed title pages in any case
 * and up to 16 lines, with a year in brackets or an imprint, an author page before them, and a page that only credits the e-text
 * are dropped; contents lists made of links, contents pages in plain lines and a contents label run together are dropped; a
 * letter drawn as a picture joins its word and a caption leaves its heading; Gutenberg's header, footer and their leftovers go;
 * its plain-text Chinese conversions are cut at their 第N回 lines (or by size); a paragraph element of indented lines (its
 * Japanese books) is split at the indents; a chapter's number set before its heading joins it.
 */
export const IMPORT_VERSION = 4;
