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
