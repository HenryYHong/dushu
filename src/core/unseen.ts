// A number the dictionary and segmentation share, apart from the dictionary's code so segment.ts does not pull it in.

/**
 * Segmentation count of a CC-CEDICT or Wiktionary word that the jieba corpus never saw (文旅, 青蒿, 胶皮): enough to beat a split
 * into rare characters, never a split into common ones (有的 stays 有 + 的). Measured on the held-out corpus (scripts: diff of dumps).
 */
export const UNSEEN_FLOOR = 5;
