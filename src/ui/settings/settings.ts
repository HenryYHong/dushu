// Settings screen: grouped controls, a live preview sentence, translation providers, speech, data. ARCHITECTURE.md 5.6.
import '../../styles/settings.css';
import type { MountFn, Settings } from '../../types';
import { AUTO_KNOWN_HELP } from '../../core/autoKnown';
import { readingFontSizeKey } from '../../store/settings';
import { h } from '../dom';
import { group, row, segmented, slider, toggle, type Control } from './controls';
import { dataGroup } from './data';
import { renderPreview } from './preview';
import { speechGroup } from './speech';
import { translationGroup } from './translation';
import { ipadGroup } from './ipad';
import { pageTitle } from '../pageHead';
import { isChinese, lang, syncsHere } from '../../lang/active';
import { aidName, aidWord, levelCount, levelLabel, levelScheme } from '../../lang/labels';
import { langSelect } from '../langSwitch';

export const mount: MountFn = (root, params, ctx) => {
  const { settings, store } = ctx;
  const controls: Control[] = [];
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => settings.set({ [k]: v } as Partial<Settings>);
  const add = <T extends Control>(c: T): T => { controls.push(c); return c; };

  // ---- reading ----
  const theme = add(segmented('theme', 'Theme', [
    { value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' },
  ], set('theme')));
  const zh = isChinese();
  const L = lang();
  const fontFamily = add(segmented('fontFamily', 'Font', zh
    ? [{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'kai', label: 'Kai' }]
    : [{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }], set('fontFamily')));
  const fontSize = add(slider((s) => s[readingFontSizeKey(s)], 'Text size', { min: 14, max: 44, step: 1, unit: ' px' },
    (v) => settings.set({ [readingFontSizeKey(settings.get())]: v })));
  const lineHeight = add(slider('lineHeight', 'Line spacing', { min: 1.4, max: 3, step: 0.1, format: (n) => n.toFixed(1) }, set('lineHeight')));
  const pageWidth = add(slider('pageWidth', 'Page width', { min: 480, max: 1200, step: 20, unit: ' px' }, set('pageWidth')));
  const layout = add(segmented('layout', 'Layout', [
    { value: 'pages', label: 'Pages' }, { value: 'scroll', label: 'Scroll' },
  ], set('layout')));
  const spread = add(segmented('spread', 'Pages shown', [
    { value: 'auto', label: 'Auto' }, { value: 'single', label: 'One page' }, { value: 'double', label: 'Two pages' },
  ], set('spread')));
  const pageTurn = add(segmented('pageTurn', 'Page turn', [
    { value: 'slide', label: 'Slide' }, { value: 'flip', label: 'Flip' }, { value: 'none', label: 'None' },
  ], set('pageTurn')));
  const script = add(segmented('script', 'Characters', [
    { value: 'original', label: 'As written' }, { value: 'simplified', label: 'Simplified' }, { value: 'traditional', label: 'Traditional' },
  ], set('script')));

  // ---- pinyin ----
  const pinyin = add(segmented('pinyin', `Show ${aidWord()}`, [
    { value: 'off', label: 'Off' }, { value: 'all', label: 'All' }, { value: 'unknown', label: 'Unknown' }, { value: 'hsk', label: levelScheme() },
  ], set('pinyin')));
  const hsk = add(slider('hskThreshold', 'Known up to', zh
    ? { min: 1, max: 7, step: 1, format: (n) => (n === 7 ? 'HSK 7-9' : `HSK ${n}`) }
    : { min: 1, max: levelCount(), step: 1, format: (n) => levelLabel(n) }, set('hskThreshold')));
  const stress = add(toggle('stress', 'Mark the stressed vowel', set('stress')));
  const style = add(segmented('pinyinStyle', 'Pinyin style', [
    { value: 'marks', label: 'Tone marks' }, { value: 'numbers', label: 'Numbers' }, { value: 'zhuyin', label: 'Zhuyin' },
  ], set('pinyinStyle')));
  const tones = add(toggle('toneColors', 'Color pinyin by tone', set('toneColors')));
  const sandhi = add(toggle('sandhi', 'Show tone changes for yī and bù', set('sandhi')));
  const autoKnown = add(toggle('autoKnown', 'Learn known words as I read', set('autoKnown')));

  // ---- lookup ----
  const trigger = add(segmented('lookupTrigger', 'Look up words with', [
    { value: 'click', label: 'Click or tap' }, { value: 'hover', label: 'Hover' },
  ], set('lookupTrigger')));
  const paragraph = add(toggle('paragraphTranslate', 'Translate paragraphs', set('paragraphTranslate')));

  // Rows that only matter in one mode are hidden in the other (a dimmed row still looks like something you can change).
  const hskRow = row('Known up to', zh ? 'Pinyin is hidden on characters you have met, with the same reading, in HSK words up to this level.'
    : `${aidName()} ${L.aid === 'furigana' ? 'are' : 'is'} hidden on words up to this level. ${L.levels.about}`, hsk);
  const spreadRow = row('Pages shown', 'Auto shows two pages on a wide screen held sideways.', spread);
  const turnRow = row('Page turn', null, pageTurn);
  const reading = group('Reading', null,
    row('Theme', 'Auto follows your device.', theme),
    row('Layout', 'Scroll puts each chapter in one long column.', layout),
    spreadRow,
    turnRow,
    row('Font', null, fontFamily),
    row('Text size', 'Pages and Scroll each keep their own.', fontSize),
    row('Line spacing', null, lineHeight),
    row('Page width', null, pageWidth),
    zh ? row('Characters', 'Show books in simplified (简体) or traditional (繁體) characters.', script) : null);
  const aidHelp = zh ? 'Unknown skips words you have marked as known. HSK also skips words up to your level.'
    : L.aid === 'furigana' ? 'Readings in kana over words with kanji. Unknown skips words you have marked as known; JLPT also skips words up to your level.'
    : 'A short English meaning over each word. Unknown skips words you have marked as known; Level also skips words up to your level.';
  const pinyinGroup = group(aidName(), null,
    row(`Show ${aidWord()}`, aidHelp, pinyin),
    hskRow,
    zh ? row('Style', null, style) : null,
    zh ? row('Tone colors', 'Red, green, blue, purple and gray for tones 1 to 5.', tones) : null,
    zh ? row('Tone changes for yī and bù', '一个 as yí gè, 不是 as bú shì.', sandhi) : null,
    L.stress ? row('Stress marks', 'A mark over the stressed vowel of each word, as in a learner’s dictionary.', stress) : null,
    row('Learn known words as I read', AUTO_KNOWN_HELP, autoKnown));
  // The language being read. Each one keeps its own books, words and settings; switching opens its library.
  const language = group('Language', null,
    row('Reading in', `Each language keeps its own library, words and settings.${syncsHere() ? '' : ` ${L.name} is not synced with your account yet: its books and words stay on this device.`}`,
      { el: langSelect('select'), update: () => {} }));
  const lookup = group('Lookup', null,
    row('Look up a word by', null, trigger),
    row('Translate paragraphs', 'With a mouse, adds a translate button beside each paragraph in Scroll.', paragraph));

  const translation = translationGroup(ctx);
  const speech = speechGroup(ctx);
  const data = dataGroup(ctx);
  const ipad = ipadGroup(params);

  // ---- preview ----
  const sample = h(zh ? 'div.set-sample.zh' : 'div.set-sample', { lang: L.tag, 'aria-label': 'Preview sentence' });
  const preview = h('section.set-preview.card', { 'aria-label': 'Preview' },
    h('div.set-preview-label', null, 'Preview'),
    sample);
  const drawPreview = () => renderPreview(sample, settings.get(), ctx.dictSync(), (w) => store.known.has(w));

  const sync = (s: Settings) => {
    for (const c of controls) c.update(s);
    translation.update(s);
    speech.update(s);
    hsk.input.disabled = s.pinyin !== 'hsk';
    hskRow.hidden = s.pinyin !== 'hsk';
    for (const r of [spreadRow, turnRow]) r.hidden = s.layout !== 'pages';
    drawPreview();
  };

  // A list of the sections at the left on a wide screen: the page is long.
  const sections: { id: string; label: string; el: HTMLElement }[] = [
    { id: 'set-language', label: 'Language', el: language },
    { id: 'set-reading', label: 'Reading', el: reading },
    { id: 'set-pinyin', label: aidName(), el: pinyinGroup },
    { id: 'set-lookup', label: 'Lookup', el: lookup },
    { id: 'set-translation', label: 'Translation', el: translation.el },
    { id: 'set-speech', label: 'Speech', el: speech.el },
    { id: 'set-ipad', label: 'iPad', el: ipad.el },
    { id: 'set-data', label: 'Data', el: data },
  ];
  for (const sec of sections) sec.el.id = sec.id;
  const navButtons = sections.map((sec) => h('button.set-nav-link', { type: 'button', 'data-target': sec.id, onclick: () => {
    sec.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    sec.el.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
    sec.el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  } }, sec.label) as HTMLButtonElement);
  const nav = h('nav.set-nav', { 'aria-label': 'Sections' }, navButtons);

  root.appendChild(h('div.page.set-page', null,
    h('div.page-head', null, h('div', null, pageTitle('settings', 'Settings'))),
    h('div.set-layout', null, nav, h('div.set-main', null, preview, ...sections.map((sec) => sec.el)))));

  // The preview sticks under the top bar, so a section the list scrolls to must stop below it, not behind it. The sticky height is
  // measured (it changes with the width, the font size and a wrapped sample) and handed to the stylesheet; a preview that is not
  // sticky (a phone, a short window) adds nothing.
  const page = root.querySelector<HTMLElement>('.set-page');
  const syncStick = () => {
    if (!page) return;
    const sticky = getComputedStyle(preview).position === 'sticky';
    page.style.setProperty('--set-stick', sticky ? `${Math.ceil(preview.getBoundingClientRect().height) + 8}px` : '0px');
  };
  syncStick();
  const stickObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(syncStick) : null;
  stickObserver?.observe(preview);
  window.addEventListener('resize', syncStick);

  // The section being read lights up in the list. At the top of the page that is the first section (before any heading has
  // reached the band the observer watches), and at the bottom the last one (a short last section never reaches it).
  const markCurrent = (id: string) => { for (const b of navButtons) b.setAttribute('aria-current', String(b.dataset.target === id)); };
  markCurrent(sections[0].id);
  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) markCurrent(seen.target.id);
    }, { rootMargin: '-20% 0px -65% 0px' });
    for (const sec of sections) observer.observe(sec.el);
  }
  const onScrollEnds = () => {
    const doc = document.documentElement;
    if (window.scrollY < 8) markCurrent(sections[0].id);
    else if (window.innerHeight + window.scrollY >= doc.scrollHeight - 4) markCurrent(sections[sections.length - 1].id);
  };
  window.addEventListener('scroll', onScrollEnds, { passive: true });

  const off = settings.subscribe((s) => sync(s));
  sync(settings.get());
  let alive = true;
  void ctx.dict().then(() => { if (alive) drawPreview(); }, () => {});

  return () => {
    alive = false;
    observer?.disconnect();
    stickObserver?.disconnect();
    window.removeEventListener('resize', syncStick);
    window.removeEventListener('scroll', onScrollEnds);
    off();
    speech.dispose();
    translation.dispose();
    ipad.dispose();
  };
};
