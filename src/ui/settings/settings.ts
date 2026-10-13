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

export const mount: MountFn = (root, _params, ctx) => {
  const { settings, store } = ctx;
  const controls: Control[] = [];
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => settings.set({ [k]: v } as Partial<Settings>);
  const add = <T extends Control>(c: T): T => { controls.push(c); return c; };

  // ---- reading ----
  const theme = add(segmented('theme', 'Theme', [
    { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' },
  ], set('theme')));
  const fontFamily = add(segmented('fontFamily', 'Font', [
    { value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'kai', label: 'Kai' },
  ], set('fontFamily')));
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
    { value: 'flip', label: 'Flip' }, { value: 'slide', label: 'Slide' }, { value: 'none', label: 'None' },
  ], set('pageTurn')));
  const script = add(segmented('script', 'Characters', [
    { value: 'original', label: 'As written' }, { value: 'simplified', label: 'Simplified' }, { value: 'traditional', label: 'Traditional' },
  ], set('script')));

  // ---- pinyin ----
  const pinyin = add(segmented('pinyin', 'Show pinyin', [
    { value: 'off', label: 'Off' }, { value: 'all', label: 'All' }, { value: 'unknown', label: 'Unknown' }, { value: 'hsk', label: 'Above HSK' },
  ], set('pinyin')));
  const hsk = add(slider('hskThreshold', 'HSK level', { min: 1, max: 7, step: 1, format: (n) => (n === 7 ? 'HSK 7-9' : `HSK ${n}`) }, set('hskThreshold')));
  const style = add(segmented('pinyinStyle', 'Pinyin style', [
    { value: 'marks', label: 'Tone marks' }, { value: 'numbers', label: 'Numbers' }, { value: 'zhuyin', label: 'Zhuyin' },
  ], set('pinyinStyle')));
  const tones = add(toggle('toneColors', 'Color pinyin by tone', set('toneColors')));
  const sandhi = add(toggle('sandhi', 'Show tone changes for yī and bù', set('sandhi')));

  // ---- lookup ----
  const trigger = add(segmented('lookupTrigger', 'Look up words with', [
    { value: 'click', label: 'Click or tap' }, { value: 'hover', label: 'Hover' },
  ], set('lookupTrigger')));
  const paragraph = add(toggle('paragraphTranslate', 'Translate whole paragraphs', set('paragraphTranslate')));

  const hskRow = row('HSK level', 'Words at or below this level lose their pinyin.', hsk);
  const spreadRow = row('Pages shown', 'Auto shows two pages side by side on a wide, landscape screen such as an iPad held sideways.', spread);
  const turnRow = row('Page turn', 'How a page turns: it flips around the spine like a leaf, slides, or just changes.', pageTurn);
  const reading = group('Reading', null,
    row('Theme', 'System follows your device.', theme),
    row('Layout', 'Pages turns like a book (tap the edges, swipe, or use the arrow keys). Scroll is one long column.', layout),
    spreadRow,
    turnRow,
    row('Font', null, fontFamily),
    row('Text size', null, fontSize),
    row('Line spacing', null, lineHeight),
    row('Page width', 'The widest the text column gets.', pageWidth),
    row('Characters', 'Convert the whole book on screen. Your saved words work in either form.', script));
  const pinyinGroup = group('Pinyin', 'Words you mark as known never show pinyin in Unknown mode.',
    row('Show pinyin', null, pinyin),
    hskRow,
    row('Style', null, style),
    row('Tone colors', 'Red, green, blue, purple and gray for tones 1 to 5.', tones),
    row('Tone changes for yī and bù', 'Show 一个 as yí gè and 不是 as bú shì, as spoken, instead of the dictionary tone.', sandhi));
  const lookup = group('Lookup', 'Double-click and drag-select always work, whichever you choose.',
    row('Look up a word by', null, trigger),
    row('Paragraph translation', 'Show a small translate button beside each paragraph (Scroll layout; in Pages, select a sentence instead).', paragraph));

  const translation = translationGroup(ctx);
  const speech = speechGroup(ctx);
  const data = dataGroup(ctx);

  // ---- preview ----
  const sample = h('div.set-sample.zh', { lang: 'zh', 'aria-label': 'Preview sentence' });
  const preview = h('section.set-preview.card', { 'aria-label': 'Preview' },
    h('div.set-preview-label', null, 'Preview'),
    sample);
  const drawPreview = () => renderPreview(sample, settings.get(), ctx.dictSync(), (w) => store.known.has(w));

  const sync = (s: Settings) => {
    for (const c of controls) c.update(s);
    translation.update(s);
    speech.update(s);
    hsk.input.disabled = s.pinyin !== 'hsk';
    hskRow.classList.toggle('set-row-off', s.pinyin !== 'hsk');
    for (const r of [spreadRow, turnRow]) r.classList.toggle('set-row-off', s.layout !== 'pages');
    drawPreview();
  };

  root.appendChild(h('div.page.set-page', null,
    h('div.page-head', null, h('div', null, h('h1.page-title', null, 'Settings'), h('p.page-sub', null, 'Changes apply right away and are saved in this browser.'))),
    preview, reading, pinyinGroup, lookup, translation.el, speech.el, ipadGroup(), data));

  const off = settings.subscribe((s) => sync(s));
  sync(settings.get());
  let alive = true;
  void ctx.dict().then(() => { if (alive) drawPreview(); }, () => {});

  return () => {
    alive = false;
    off();
    speech.dispose();
  };
};
