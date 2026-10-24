/** A problem with the user's file, worded for the user. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const NO_CHINESE = 'No Chinese text found in this file. Dushu reads books written in Chinese characters.';

export const PDF_HOST_MESSAGE =
  'The PDF reader could not start. This is a problem with how Dushu is being served (its PDF worker file could not be loaded), not with your file. Reload the page and try again.';

export const PDF_OFFLINE_MESSAGE = 'PDF import needs a connection the first time. Connect once and try again.';

/**
 * True when the server Dushu came from does not answer: the device is offline, or the Mac is asleep. A HEAD request is
 * never answered by the service worker (it serves GET only), so it reaches the network.
 */
async function serverUnreachable(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof document === 'undefined' || typeof fetch !== 'function') return false;
  try {
    await fetch(new URL('./', document.baseURI).href, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return false;
  } catch {
    return true;
  }
}

/** The PDF reader's own files did not load: offline before they were ever stored, or a hosting problem. */
export async function pdfStartFailure(): Promise<ImportError> {
  return new ImportError((await serverUnreachable()) ? PDF_OFFLINE_MESSAGE : PDF_HOST_MESSAGE);
}
