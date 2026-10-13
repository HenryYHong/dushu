// The keyboard shortcuts, in one place so the reader's sheet and the About page cannot drift apart.
// Keep this in step with the key handlers in ui/reader/reader.ts, ui/popup/host.ts and ui/review/review.ts.
export interface ShortcutRow { keys: string[]; what: string }
export interface ShortcutGroup { group: string; rows: ShortcutRow[] }

export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Reading',
    rows: [
      { keys: ['Click'], what: 'Look up a word (or hover, if you chose that)' },
      { keys: ['Double-click'], what: 'Look up a word' },
      { keys: ['Drag'], what: 'Select a phrase or sentence for pinyin and a translation' },
      { keys: ['P'], what: 'Cycle pinyin: off, all, unknown, HSK' },
      { keys: ['[', ']'], what: 'Smaller and larger text' },
      { keys: ['C'], what: 'Open the chapter list' },
      { keys: ['Page Down'], what: 'At the end of a chapter, go to the next one' },
      { keys: ['Page Up'], what: 'At the top of a chapter, go to the previous one' },
      { keys: ['Shift', '→'], what: 'Next chapter, from anywhere' },
      { keys: ['Shift', '←'], what: 'Previous chapter, from anywhere' },
      { keys: ['?'], what: 'Show the shortcut sheet' },
      { keys: ['Esc'], what: 'Close the open card or menu' },
    ],
  },
  {
    group: 'In a word card',
    rows: [
      { keys: ['←', '→'], what: 'Previous and next word' },
      { keys: ['Shift', '←', '→'], what: 'Make the selection shorter or longer' },
      { keys: ['S'], what: 'Save the word to your flashcards' },
      { keys: ['K'], what: 'Mark the word as known' },
      { keys: ['P'], what: 'Play the pronunciation' },
    ],
  },
  {
    group: 'Review',
    rows: [
      { keys: ['Space'], what: 'Reveal the answer' },
      { keys: ['1', '2', '3', '4'], what: 'Again, Hard, Good, Easy' },
      { keys: ['P'], what: 'Play the pronunciation' },
    ],
  },
];
