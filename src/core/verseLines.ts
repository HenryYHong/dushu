// Chinese verse typed as plain paragraphs: the importer marks a poem's title with them (import/chapters.ts, markPoemTitles) and the
// reader sets its lines (ui/reader/verse.ts).

/** "靜夜思　李白": a title, a wide space and the poet's name. */
export const POEM_TITLE = /^[\u3400-\u9fff]{1,12}[\u3000 ]+[\u3400-\u9fff]{2,4}$/u;
/** A line of verse: short clauses, each closed by a mark, the last by a full stop. */
export const VERSE_LINE = /^(?:[\u3400-\u9fff]{1,9}[，、；：])+[\u3400-\u9fff]{1,9}[。！？]$/u;
