// The languages' English names, with nothing else imported: the servers (the Mac bridge, cloud/) name the language in a
// translation prompt without pulling in any engine.
import type { LangId } from './types';

export const LANG_NAMES: Record<LangId, string> = {
  zh: 'Chinese', ja: 'Japanese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
};

/** A language a translation request may name, other than Chinese (which is what a request with no language is). */
export function otherLang(v: unknown): Exclude<LangId, 'zh'> | undefined {
  return typeof v === 'string' && v !== 'zh' && Object.prototype.hasOwnProperty.call(LANG_NAMES, v) ? v as Exclude<LangId, 'zh'> : undefined;
}
