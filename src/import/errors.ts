/** A problem with the user's file, worded for the user. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const NO_CHINESE = 'No Chinese text found in this file. Dushu reads books written in Chinese characters.';
