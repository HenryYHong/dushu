// Narrow, evidence-based choices for older usage. Unmatched passages keep all dictionary senses.
export function dictionaryContextMeaning(word: string, paragraph: string, senses: string[]): { meaning: string; reason: string } | null {
  if (word !== '酒店' || !senses.some(sense => /wine shop|tavern|\bpub\b/i.test(sense))) return null;
  // An explicit "no accommodation" is not evidence for the hotel sense.
  const lodgingEvidence = paragraph.replace(/不(?:提供|供)住宿|不(?:提供|供)客房|(?:没有|沒有)客房/gu, '');
  if (/客房|住宿|入住|退房|住[进進]|[订訂]房|旅[馆館]|[宾賓][馆館]/u.test(lodgingEvidence)) return null;
  const warmingWine = /[温溫]酒/u.test(paragraph);
  const sellingBowls = /[买買][^。！？\n]{0,8}[碗壶壺杯][^。！？\n]{0,3}酒/u.test(paragraph);
  if (!warmingWine || !sellingBowls) return null;
  return {
    meaning: 'wine shop or tavern',
    reason: 'Here the paragraph describes warming wine and selling it by the bowl; 酒店 uses its older wine-shop meaning.',
  };
}

export interface WordSenseHint { word: string; kind: 'tavern' | 'lodging'; sense: string }

/**
 * The sense of 酒店 the paragraph itself supports: an old wine shop (wine is warmed and sold by the bowl) or a hotel (rooms are
 * booked or full). Anything else gets no hint, so the model reads the passage on its own.
 */
export function wordSenseHint(text: string, context: string): WordSenseHint | null {
  if (!text.includes('酒店')) return null;
  const evidence = context || text;
  if (dictionaryContextMeaning('酒店', evidence, ['hotel', 'wine shop'])) {
    return { word: '酒店', kind: 'tavern', sense: 'wine shop or tavern; older usage supported by warming wine and selling bowls of it' };
  }
  if (/[订訂][^。！？\n]{0,8}(?:客房|房[间間])|酒店[^。！？\n]{0,12}客房[^。！？\n]{0,12}住满/u.test(evidence)) {
    return { word: '酒店', kind: 'lodging', sense: 'hotel/accommodation; the passage explicitly describes booking or occupied guest rooms' };
  }
  return null;
}
