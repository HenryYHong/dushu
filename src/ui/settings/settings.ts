// Settings screen: grouped controls, a live preview sentence, translation providers, speech, data. ARCHITECTURE.md 5.6.
import '../../styles/settings.css';
import type { MountFn, Settings } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { h } from '../dom';
import { group, row, segmented, slider, toggle, type Control } from './controls';
import { dataGroup } from './data';
import { renderPreview } from './preview';
import { speechGroup } from './speech';
import { translationGroup } from './translation';
import { ipadGroup } from './ipad';
import { pageTitle } from '../pageHead';
import { isChinese, lang } from '../../lang/active';
import { aidName, aidWord, autoKnownHelp, glossLanguage, levelCount, levelLabel, levelScheme } from '../../lang/labels';
import { langSelect } from '../langSwitch';
import { learningControls } from './learning';
import { tt, uiLocale } from '../../i18n';
import { meaningsTarget } from '../../translate/meanings';

export const mount: MountFn = (root, params, ctx) => {
  const { settings, store } = ctx;
  const controls: Control[] = [];
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => settings.set({ [k]: v } as Partial<Settings>);
  const add = <T extends Control>(c: T): T => { controls.push(c); return c; };
  const decimal = new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const oneDecimal = (n: number) => decimal.format(n);

  // ---- reading ----
  const theme = add(segmented('theme', tt('Theme'), [
    { value: 'system', label: tt('Auto') }, { value: 'light', label: tt('Light') }, { value: 'sepia', label: tt('Sepia') }, { value: 'dark', label: tt('Dark') },
  ], set('theme')));
  const zh = isChinese();
  const L = lang();
  const fontFamily = add(segmented('fontFamily', tt('Font'), zh
    ? [{ value: 'serif', label: tt('Serif') }, { value: 'sans', label: tt('Sans') }, { value: 'kai', label: tt('Kai') }]
    : [{ value: 'serif', label: tt('Serif') }, { value: 'sans', label: tt('Sans') }], set('fontFamily')));
  const fontSize = add(slider((s) => s[readingFontSizeKey(s)], tt('Text size'), { min: 14, max: 44, step: 1, unit: ' px' },
    (v) => settings.set({ [readingFontSizeKey(settings.get())]: v })));
  const lineHeight = add(slider('lineHeight', tt('Line spacing'), { min: 1.4, max: 3, step: 0.1, format: oneDecimal }, set('lineHeight')));
  const pageWidth = add(slider('pageWidth', tt('Page width'), { min: 480, max: 1200, step: 20, unit: ' px' }, set('pageWidth')));
  const layout = add(segmented('layout', tt('Layout'), [
    { value: 'pages', label: tt('Pages') }, { value: 'scroll', label: tt('Scroll') },
  ], set('layout')));
  const spread = add(segmented('spread', tt('Pages shown'), [
    { value: 'auto', label: tt('Auto') }, { value: 'single', label: tt('One page') }, { value: 'double', label: tt('Two pages') },
  ], set('spread')));
  const pageTurn = add(segmented('pageTurn', tt('Page turn'), [
    { value: 'slide', label: tt('Slide') }, { value: 'flip', label: tt('Flip') }, { value: 'none', label: tt('None') },
  ], set('pageTurn')));
  const script = add(segmented('script', tt('Characters'), [
    { value: 'original', label: tt('As written') }, { value: 'simplified', label: tt('Simplified') }, { value: 'traditional', label: tt('Traditional') },
  ], set('script')));

  // ---- pinyin ----
  const pinyin = add(segmented('pinyin', tt('Show {aid}', { aid: aidWord() }), [
    { value: 'off', label: tt('Off') }, { value: 'all', label: tt('All') }, { value: 'unknown', label: tt('Unknown') }, { value: 'hsk', label: levelScheme() },
  ], set('pinyin')));
  const hsk = add(slider('hskThreshold', tt('Known up to'), zh
    ? { min: 1, max: 7, step: 1, format: (n) => (n === 7 ? 'HSK 7-9' : `HSK ${n}`) }
    : { min: 1, max: levelCount(), step: 1, format: (n) => levelLabel(n) }, set('hskThreshold')));
  const stress = add(toggle('stress', tt('Mark the stressed vowel'), set('stress')));
  const style = add(segmented('pinyinStyle', tt('Pinyin style'), [
    { value: 'marks', label: tt('Tone marks') }, { value: 'numbers', label: tt('Numbers') }, { value: 'zhuyin', label: tt('Zhuyin') },
  ], set('pinyinStyle')));
  const tones = add(toggle('toneColors', tt('Color pinyin by tone'), set('toneColors')));
  const sandhi = add(toggle('sandhi', tt('Show tone changes for yī and bù'), set('sandhi')));
  const autoKnown = add(toggle('autoKnown', tt('Learn known words as I read'), set('autoKnown')));

  // ---- lookup ----
  const trigger = add(segmented('lookupTrigger', tt('Look up words with'), [
    { value: 'click', label: tt('Click or tap') }, { value: 'hover', label: tt('Hover') },
  ], set('lookupTrigger')));
  const paragraph = add(toggle('paragraphTranslate', tt('Translate paragraphs'), set('paragraphTranslate')));
  const meanings = add(segmented('translateMeanings', tt('Meanings in your language'), [
    { value: 'auto', label: tt('Automatic') }, { value: 'always', label: tt('Always') }, { value: 'ask', label: tt('When I ask') }, { value: 'never', label: tt('Never') },
  ], set('translateMeanings')));

  // Rows that only matter in one mode are hidden in the other (a dimmed row still looks like something you can change).
  // The level scheme's own words (L.levels.about) follow the sentence: two whole sentences, joined.
  const hskRow = row(tt('Known up to'), zh ? tt('Pinyin is hidden on characters you have met, with the same reading, in HSK words up to this level.')
    : `${tt('{aid} are hidden on words up to this level.', { aid: aidName() })} ${tt(L.levels.about)}`, hsk);
  const spreadRow = row(tt('Pages shown'), tt('Auto shows two pages on a wide screen held sideways.'), spread);
  const turnRow = row(tt('Page turn'), null, pageTurn);
  const reading = group(tt('Reading'), null,
    row(tt('Theme'), tt('Auto follows your device.'), theme),
    row(tt('Layout'), tt('Scroll puts each chapter in one long column.'), layout),
    spreadRow,
    turnRow,
    row(tt('Font'), null, fontFamily),
    row(tt('Text size'), tt('Pages and Scroll each keep their own.'), fontSize),
    row(tt('Line spacing'), null, lineHeight),
    row(tt('Page width'), null, pageWidth),
    zh ? row(tt('Characters'), tt('Show books in simplified (简体) or traditional (繁體) characters.'), script) : null);
  const aidHelp = zh ? tt('Unknown skips words you have marked as known. HSK also skips words up to your level.')
    : L.aid === 'furigana' ? tt('Readings in kana over words with kanji. Unknown skips words you have marked as known; JLPT also skips words up to your level.')
    : tt('A short {language} meaning over each word. Unknown skips words you have marked as known; {scheme} also skips words up to your level.',
      { language: glossLanguage(), scheme: levelScheme() });
  const pinyinGroup = group(aidName(), null,
    row(tt('Show {aid}', { aid: aidWord() }), aidHelp, pinyin),
    hskRow,
    zh ? row(tt('Style'), null, style) : null,
    zh ? row(tt('Tone colors'), tt('Red, green, blue, purple and gray for tones 1 to 5.'), tones) : null,
    zh ? row(tt('Tone changes for yī and bù'), tt('一个 as yí gè, 不是 as bú shì.'), sandhi) : null,
    L.stress ? row(tt('Stress marks'), tt('A mark over the stressed vowel of each word, as in a learner’s dictionary.'), stress) : null,
    row(tt('Learn known words as I read'), autoKnownHelp(), autoKnown));
  // The language being read. Each one keeps its own books, words and settings; switching opens its library. Then what the
  // reader is learning and the daily goal (core/plan.ts).
  const learning = learningControls(ctx);
  const language = group(tt('Learning'), null,
    row(tt('Your language'), tt('The app is shown in it, and sentences are translated into it.'), learning.own, 'set-ui-lang'),
    row(tt('Reading in'), tt('Each language keeps its own library, words and settings, and syncs them on its own.'),
      { el: langSelect('select'), update: () => {} }),
    row(tt('Languages you are learning'), tt('These come first when you switch languages.'), learning.langs),
    row(tt('Daily goal'), tt('Minutes of reading or review a day, in any language. Each day you reach it adds to your streak.'), learning.goal),
    row(tt('Welcome screen'), tt('Choose your languages, translation language and goal again, step by step.'), learning.welcome),
    row(tt('Walkthrough'), tt('A tour of the library, then of the reader the next time you open a book.'), learning.walkthrough));
  // The word cards' meanings in the reader's language (translate/meanings.ts). Shown only when that is not the dictionary's.
  const meaningsRow = row(tt('Meanings in your language'), tt('Word cards translate the dictionary’s {original} into your language and keep the {original} under each meaning. Automatic uses Chrome’s free on-device translator, and an online one (Qwen through your account, Claude or MyMemory) only when you press the button on the card. Always uses any of them without asking.', { original: glossLanguage() }), meanings);
  const lookup = group(tt('Lookup'), null,
    row(tt('Look up a word by'), null, trigger),
    meaningsRow,
    row(tt('Translate paragraphs'), tt('With a mouse, adds a translate button beside each paragraph in Scroll.'), paragraph));

  const translation = translationGroup(ctx);
  const speech = speechGroup(ctx);
  const data = dataGroup(ctx);
  const ipad = ipadGroup(params);

  // ---- preview ----
  const sample = h(zh ? 'div.set-sample.zh' : 'div.set-sample', { lang: L.tag, 'aria-label': tt('Preview sentence') });
  const preview = h('section.set-preview.card', { 'aria-label': tt('Preview') },
    h('div.set-preview-label', null, tt('Preview')),
    sample);
  const drawPreview = () => renderPreview(sample, settings.get(), ctx.dictSync(), (w) => store.known.has(w));

  const sync = (s: Settings) => {
    for (const c of controls) c.update(s);
    translation.update(s);
    speech.update(s);
    hsk.input.disabled = s.pinyin !== 'hsk';
    hskRow.hidden = s.pinyin !== 'hsk';
    for (const r of [spreadRow, turnRow]) r.hidden = s.layout !== 'pages';
    meaningsRow.hidden = meaningsTarget({ translateTo: s.translateTo, translateMeanings: 'auto' }) === null;
    drawPreview();
  };

  // A list of the sections at the left on a wide screen: the page is long.
  const sections: { id: string; label: string; el: HTMLElement }[] = [
    { id: 'set-language', label: tt('Learning'), el: language },
    { id: 'set-reading', label: tt('Reading'), el: reading },
    { id: 'set-pinyin', label: aidName(), el: pinyinGroup },
    { id: 'set-lookup', label: tt('Lookup'), el: lookup },
    { id: 'set-translation', label: tt('Translation'), el: translation.el },
    { id: 'set-speech', label: tt('Speech'), el: speech.el },
    // Named by the group's own heading: "Sync" for a visitor, "Your Mac and iPad" for the owner.
    { id: 'set-ipad', label: ipad.el.querySelector('h2')?.textContent || tt('Sync'), el: ipad.el },
    { id: 'set-data', label: tt('Data'), el: data },
  ];
  for (const sec of sections) sec.el.id = sec.id;
  const navButtons = sections.map((sec) => h('button.set-nav-link', { type: 'button', 'data-target': sec.id, onclick: () => {
    sec.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    sec.el.querySelector<HTMLElement>('h2')?.setAttribute('tabindex', '-1');
    sec.el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  } }, sec.label) as HTMLButtonElement);
  const nav = h('nav.set-nav', { 'aria-label': tt('Sections') }, navButtons);

  root.appendChild(h('div.page.set-page', null,
    h('div.page-head', null, h('div', null, pageTitle('settings', tt('Settings')))),
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
    learning.dispose();
  };
};
