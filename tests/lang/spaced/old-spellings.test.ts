// Older spellings of the classics read as today's words, for a word no dictionary has as printed: Dante's ’l (il),
// Cervantes's dejalle (dejarle), ferido (herido), habedes (habéis), estrañeza (extrañeza); German verse's gnäd'ge
// (gnädige), geschehn (geschehen), hätt (hätte); the Russian gerunds увидя (увидеть), обратясь (обратиться); Eça's snr.
// (senhor), chinez (chinês), podesse (pudesse). Words spelled today's way stay as they are.
import { expect, it } from 'vitest';
import { loadLang } from './load';

const heads = async (id: Parameters<typeof loadLang>[0], sentence: string) => {
  const eng = await loadLang(id);
  return Object.fromEntries(eng.segment(sentence).filter((t) => t.kind === 'word' && /\p{L}/u.test(t.text))
    .map((t) => [t.text, eng.lookup(t.text, { token: t, sentence }).entries[0]?.head]));
};

it('reads Dante’s ’l as il, the article before a noun', async () => {
  expect(await heads('it', 'che ’l sole mi guidava')).toMatchObject({ l: 'il', sole: 'sole' });
});

it('reads Cervantes’s spellings', async () => {
  expect(await heads('es', 'Y será bien dejalle, y a decille si estaba; ponello en duda')).toMatchObject({ dejalle: 'dejar', decille: 'decir', ponello: 'poner' });
  expect(await heads('es', 'el mal ferido caballero, que me habedes fecho, la estrañeza')).toMatchObject({ ferido: 'herido', habedes: 'haber', estrañeza: 'extrañeza' });
  expect(await heads('es', 'la calle del valle')).toMatchObject({ calle: 'calle', valle: 'valle' });
});

it('reads German verse with its dropped vowels', async () => {
  expect(await heads('de', 'Und gnäd’ge Frau, die heil’gen Zeichen; laßt genug geschehn! Hätt ich')).toMatchObject({ 'gnäd’ge': 'gnädig', 'heil’gen': 'heilig', geschehn: 'geschehen', Hätt: 'haben' });
});

it('reads the old Russian gerunds', async () => {
  expect(await heads('ru', 'Женщины, увидя нас, прятались; он, обратясь ко мне, сел безо всякого')).toMatchObject({ увидя: 'увидеть', обратясь: 'обратиться', безо: 'без' });
  expect(await heads('ru', 'Моя тётя видела дядю и Таню.')).toMatchObject({ тётя: 'тётя', дядю: 'дядя' });
});

it('reads Eça’s spellings', async () => {
  expect(await heads('pt', 'O snr. Theodoro, um barbeiro chinez; nunca pensei que se podesse')).toMatchObject({ snr: 'senhor', chinez: 'chinês', podesse: 'poder' });
});
