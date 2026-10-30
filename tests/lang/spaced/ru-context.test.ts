// Russian context rules (src/lang/spaced/ru-context.ts) on the sentences a native read of Tolstoy's stories for children,
// Chekhov's Kashtanka (1887), Dostoevsky's White Nights (1848), Gogol's The Overcoat (1842) and Pushkin's The Captain's
// Daughter (1836) found misread: each word whose reading depends on its neighbors, in the sentence the book has it.
import { describe, expect, it } from 'vitest';
import { loadLang, lookupIn, tok } from './load';

/** The token's key and hint, as the reader shows them. */
async function read(text: string, word: string, nth = 0): Promise<[string, string | undefined]> {
  const ru = await loadLang('ru');
  const t = tok(ru, text, word, nth);
  return [t.key!, ru.hint(t)];
}

describe('его, её, их: his or him', () => {
  it('are "him, it", "her, it", "them" after a verb and before what is not theirs', async () => {
    // Tolstoy, Три медведя.
    expect(await read('Михайло Иваныч взглянул на свой стул и зарычал страшным голосом: «Кто сидел на моем стуле и сдвинул его с места!»', 'его'))
      .toEqual(['он', 'him, it']);
    expect(await read('Один медведь был отец, звали его Михаил Иваныч.', 'его')).toEqual(['он', 'him, it']);
    // A noun in the instrumental after a verb is how it was done: "Лев и собачка".
    expect(await read('Лев тронул ее лапой и перевернул.', 'ее')).toEqual(['она', 'her, it']);
    // Kashtanka.
    expect((await read('Но из дому выбежал мужик в шубе и прогнал их кнутом; тогда Тётка подошла к лохани и стала кушать.', 'их'))[0]).toBe('они');
    // A time before it is no owner when the clause has its subject: White Nights.
    expect(await read('Я целый год его любила и богом клянусь, что никогда, никогда даже мыслью не была ему неверна.', 'его')).toEqual(['он', 'him, it']);
  });

  it('are "his, her, their" before the noun they own, after a preposition and after their noun', async () => {
    // Kashtanka.
    expect(await read('Тётка не понимала, что говорит хозяин, но по его лицу видела, что и он ждёт чего-то ужасного.', 'его')).toEqual(['его', 'his']);
    expect(await read('Хозяин пригнул его голову к блюдечку и окунул клюв в воду.', 'его')).toEqual(['его', 'his']);
    expect(await read('Это крикнул Иван Иваныч, и крик его был не болтливый и убедительный, как обыкновенно.', 'его')).toEqual(['его', 'his']);
    expect(await read('При появлении их Тётка виляла хвостом, и ей казалось, что она их где-то когда-то видела и любила…', 'их'))
      .toEqual(['их', 'their']);
    // White Nights.
    expect((await read('Я разбил последнюю ее надежду.', 'ее'))[0]).toBe('ее');
  });
});

describe('все: all, everyone or everything', () => {
  it('is весь "all" before a noun, все "everyone" before a plural verb, всё otherwise', async () => {
    expect(await read('Пошли раз все ребята в школу.', 'все')).toEqual(['весь', 'all']);
    expect(await read('— Все засмеялись.', 'Все')).toEqual(['все', 'everyone']);
    // White Nights: a preposition and its pronoun may stand between.
    const s = 'Мне вдруг показалось, что меня, одинокого, все покидают и что все от меня отступаются.';
    expect((await read(s, 'все', 0))[1]).toBe('everyone');
    expect((await read(s, 'все', 1))[1]).toBe('everyone');
    expect((await read('Ну, да я вам завтра все расскажу, вы все узнаете, все…', 'все'))[1]).toBe('everything');
    // A masculine noun after it is what all of it is: "all is nonsense".
    expect((await read('Что я буду теперь говорить, все вздор, все несбыточно, все глупо!', 'все'))[1]).toBe('everything');
    expect((await read('Но все та же фантазия подхватила на своем игривом полете и старушку.', 'все'))[0]).toBe('все');
  });
});

describe('да, что, как, чем, то', () => {
  it('да before a comma or ! is "yes"; inside a clause, "and, but"', async () => {
    expect((await read('— Да, вы наймите у нас.', 'Да'))[1]).toBe('yes');
    expect((await read('— Ну, да, да!', 'да', 1))[1]).toBe('yes');
    expect((await read('В лесу она заблудилась и стала искать дорогу домой, да не нашла, а пришла в лесу к домику.', 'да'))[1])
      .toBe('and, but');
  });

  it('что opening a question or after a preposition is "what"; inside a sentence, "that"', async () => {
    expect((await read('Бабушка кричит: «Что ж ты стоишь?» — а я еще пуще…', 'Что'))[1]).toBe('what');
    const why = '— За что? за то, что меня бог послал?';
    expect((await read(why, 'что', 0))[1]).toBe('what');
    expect((await read(why, 'что', 1))[1]).toBe('that');
    // Tolstoy, Филипок: what to do, at the end of the clause; "so frightened that he could not speak".
    expect((await read('И стал он думать, что ему делать.', 'что'))[1]).toBe('what');
    expect((await read('— Филипок так напугался, что говорить не мог.', 'что'))[1]).toBe('that');
  });

  it('как opening a question or after знать is "how"; after так, "as"', async () => {
    expect((await read('Как же я теперь буду обходиться без тебя?', 'Как'))[1]).toBe('how');
    expect((await read('Я даже не знаю, как говорить с ними.', 'как'))[1]).toBe('how');
    expect((await read('Здесь ровно год тому назад бродил я так же одиноко, так же уныло, как и теперь!', 'как'))[1]).toBe('as, like');
    // A Hero of Our Time (Taman): before a noun set off by commas it compares, though the sentence exclaims.
    const stone = 'Как камень, брошенный в гладкий источник, я встревожил их спокойствие и, как камень, едва сам не пошел ко дну!';
    expect((await read(stone, 'Как'))[1]).toBe('as, like');
    expect((await read(stone, 'как'))[1]).toBe('as, like');
    expect((await read('Боже, как все это кончилось!', 'как'))[1]).toBe('how');
  });

  it('чем after a preposition is что "what", тем before a comparative "all the (more)"', async () => {
    expect(await read('Наконец я только сегодня поутру догадался, в чем дело.', 'чем')).toEqual(['что', 'what']);
    const kashtanka = 'Тётка закрыла глаза, чтобы поскорее уснуть, так как она знала по опыту, что чем скорее уснёшь, тем скорее наступит утро.';
    expect((await read(kashtanka, 'чем'))[1]).toBe('than');
    expect((await read(kashtanka, 'тем'))[0]).toBe('тем');
  });

  it('то before ", что" and after a preposition is the pronoun "that", not "then"', async () => {
    expect(await read('Получилось то, что незнакомец называл египетской пирамидой.', 'то')).toEqual(['то', 'that']);
    const ru = await loadLang('ru');
    const why = '— За что? за то, что меня бог послал?';
    expect(lookupIn(ru, why, 'то').entries[0].senses[0].pos).toBe('pronoun');
  });
});

describe('the words a preposition governs', () => {
  it('reads a noun, not an adverb, verb or adjective, after a preposition', async () => {
    expect((await read('Одна девочка ушла из дома в лес.', 'дома'))[0]).toBe('дом');
    expect((await read('Каштанка принималась бегать за ним со звонким лаем.', 'лаем'))[0]).toBe('лай');
    expect((await read('Пойду ли на Невский, пойду ли в сад, брожу ли по набережной — ни одного лица из тех, кого привык встречать.', 'набережной'))[1])
      .toBe('embankment');
  });

  it('keeps an adverb that tells how much of the next word', async () => {
    expect((await read('Смотрел ли я на тяжело нагруженные домашнею утварью лодки, скользившие по Неве.', 'тяжело'))[0]).toBe('тяжело');
  });
});

describe('words that are two words', () => {
  it('начала before an infinitive or next to its subject is "began"', async () => {
    expect((await read('Тут Настенька остановилась и начала хохотать.', 'начала'))[0]).toBe('начать');
    expect((await read('— Боже! какой вы друг! — начала она через минуту очень серьезно.', 'начала'))[0]).toBe('начать');
    expect((await read('— Касатик! а касатик! — начала Матрена.', 'начала'))[0]).toBe('начать');
    // A -ся infinitive, which the dictionary reads first as бросать's passive.
    expect((await read('У меня вся кровь начала бросаться в голову, когда я с ним повстречаюсь.', 'начала'))[0]).toBe('начать');
    // Not a verb that takes no infinitive: "Стану морю кланяться" bows to the sea (A Hero of Our Time).
    expect((await read('Стану морю кланяться Я низехонько.', 'морю'))[0]).toBe('море');
  });

  it('есть after стала is "to eat"; the "there is" of быть elsewhere', async () => {
    expect(await read('Она взяла синенькую чашечку на колена и стала есть.', 'есть')).toEqual(['есть', 'to eat']);
    expect(await read('У столяра же вся квартира битком набита вещами; у него есть стол, верстак, куча стружек.', 'есть'))
      .toEqual(['быть', 'there is, is']);
  });

  it('самой before a noun is самый, самим before a pronoun сам', async () => {
    expect((await read('Девочка взяла самую большую ложку и похлебала из самой большой чашки.', 'самой'))[0]).toBe('самый');
    expect((await read('Знаете ли, как надолго вы помирили меня с самим собою?', 'самим'))[0]).toBe('сам');
  });

  it('Полноте! is "come now", право between commas "really", ровно before a time "exactly"', async () => {
    expect(await read('— Да я спокойна. Полноте! Это так!', 'Полноте')).toEqual(['полноте', 'come now, enough']);
    expect((await read('Но я, право, не знаю, как отвечать; я боюсь…', 'право'))[1]).toBe('indeed');
    expect((await read('Первые имели право бить её, а вторых она сама имела право хватать за икры.', 'право'))[1]).toBe('right');
    expect((await read('Он в тот же день, как приедет, будет сюда ровно в десять часов.', 'ровно'))[1]).toBe('exactly');
  });

  it('ничего standing alone is "it\'s all right"; ни … ни "neither, nor"', async () => {
    expect((await read('— Нет, ничего, ничего; напротив.', 'ничего'))[0]).toBe('ничего');
    expect((await read('У незнакомца обстановка бедная; у него нет ничего, и комната кажется пустою.', 'ничего'))[0]).toBe('ничто');
    expect((await read('Они не пощадили ничего: ни колонн, ни карнизов, и мой приятель пожелтел, как канарейка.', 'ни'))[1])
      .toBe('neither, nor');
  });

  it('after an adjective, the noun; after a subject, the verb', async () => {
    expect((await read('Тщедушная кухарка, берегущая барское добро как зеницу ока.', 'добро'))[1]).toBe('good');
    expect((await read('Большой медведь взял свою чашку, взглянул и заревел страшным голосом: «Кто хлебал в моей чашке!»', 'хлебал'))[0])
      .toBe('хлебать');
    // An adjective before its noun stays one: Kashtanka's first line.
    expect((await read('Молодая рыжая собака — помесь такса с дворняжкой — бегала взад и вперёд по тротуару.', 'рыжая'))[1]).toBe('red');
  });
});

describe('old spellings', () => {
  it('read счастие, жизнию, воспоминанья as счастье, жизнь, воспоминание', async () => {
    expect((await read('Новый сон — новое счастие!', 'счастие'))[0]).toBe('счастье');
    expect((await read('Я никогда не способен начать жить настоящею жизнию.', 'жизнию'))[0]).toBe('жизнь');
    expect((await read('Я даже один раз заплакал от воспоминанья, как вы…', 'воспоминанья'))[0]).toBe('воспоминание');
  });
});

describe('hints and phrases from the read', () => {
  it('give the sense a book means', async () => {
    // White Nights: agitation, not the sea's "choppiness"; Tolstoy's teacher strokes the boy's head, he does not iron it.
    expect((await read('— Настенька! — окликнул я ее, через силу подавляя свое волнение.', 'волнение'))[1]).toBe('agitation, excitement');
    expect((await read('Тогда учителю жалко его стало. Он погладил его по голове.', 'погладил'))[1]).toBe('to stroke, to iron');
    expect((await read('Пока её новый хозяин, развалившись в кресле, курил сигару, она виляла хвостом.', 'Пока'))[1]).toBe('while, until');
    const hints: [string, string, string][] = [
      ['Она потом села на маленький стульчик и засмеялась, так было хорошо.', 'так', 'so, like that'],
      ['Мне вдруг послышалось глухое рыдание. Да! я не обманулся: девушка плакала.', 'обманулся', 'to be mistaken'],
      ['Этот, проснувшись, не издавал никакого звука, не шевелился и даже не открывал глаз.', 'издавал', 'to emit, to publish'],
      ['У меня покамест нет ничего, даже места порядочного.', 'покамест', 'for now, until'],
      // оттого, что is the conjunction "because" with a comma in it.
      ['То это оттого, что никогда еще ее не обхватывала такая хорошенькая маленькая ручка.', 'оттого', 'because'],
      ['Смотрел ли я на тяжело нагруженные домашнею утварью лодки, скользившие по Неве иль Фонтанке.', 'иль', 'or'],
      ['Они отличались щегольскими летними костюмами и прекрасными экипажами, в которых они приехали в город.', 'экипажами', 'carriage, crew'],
      ['Возы были нагружены целыми горами всякой мебели.', 'всякой', 'any, anyone'],
      // Kashtanka's trainer sets up a frame shaped like the letter П, not a "section".
      ['Незнакомец поставил П посреди комнаты, долго что-то развязывал и завязывал.', 'П', 'letter П'],
    ];
    for (const [text, word, hint] of hints) expect((await read(text, word))[1]).toBe(hint);
  });

  it('read the fixed phrases a book has word for word', async () => {
    expect((await read('Робко прибавила она, потому что все еще чувствовала какое-то уважение к моей патетической речи.', 'еще'))[1]).toBe('still');
    expect((await read('— Ведь мы теперь навсегда вместе, не правда ли?', 'правда'))[1]).toBe("isn't it?");
    // Kashtanka: "и т. п." closing the paragraph, its last period the sentence's.
    expect((await read('Потом стал учить кота курить и т. п.', 'т.'))[1]).toBe('etc');
    expect((await read('Тётке казалось, что и с нею случится то же самое.', 'то'))[1]).toBe('the same');
  });
});

// The native re-audit of The Overcoat and The Captain's Daughter, with the three books above (2026-10-29).
describe('the re-audit: pronouns that stand for a thing', () => {
  it('give он and она\'s other cases "him, it" and "her, it"', async () => {
    expect(await read('Мишутка взглянул на свой сломанный стульчик и пропищал: «Кто сидел на моем стуле и сломал его!»', 'его'))
      .toEqual(['он', 'him, it']);
    expect(await read('Петрович взял капот, разложил его сначала на стол, рассматривал долго, покачал головою.', 'его'))
      .toEqual(['он', 'him, it']);
    // The Captain's Daughter: after a noun the dictionary lacks, его is still its owner's.
    expect(await read('Сметливость его и тонкость чутья меня изумили.', 'его')).toEqual(['его', 'his']);
    // The Overcoat: after a preposition that is an adverb as well.
    expect(await read('Она часто видит его самого, как он проезжает мимо их дома.', 'их')).toEqual(['их', 'their']);
  });
});

describe('the re-audit: words standing alone', () => {
  it('read о before a word it cannot govern as "oh"', async () => {
    expect(await read('— О, вы угадали с первого раза!', 'О')).toEqual(['о', 'oh']);
    expect(await read('О незваный господин!', 'О')).toEqual(['о', 'oh']);
    // Kashtanka: before a word in the prepositional it is "about".
    expect(await read('Но она ни о чём не думала и только плакала.', 'о')).toEqual(['о', 'about']);
  });

  it('read an interjection standing alone as one', async () => {
    expect(await read('— Ладно, ладно!', 'Ладно')).toEqual(['ладно', 'all right, OK']);
    expect((await read('«Гм, понимаю… и не давать ему воли» нет, видно ешовы рукавицы значит не то.', 'Гм'))[0]).toBe('хм');
    expect(await read('— Эй ты, пёс, поди сюда!', 'Эй')).toEqual(['эй', 'hey!']);
    // But not a word first read as a conjunction or adverb: Kashtanka's "Однако, плохо же кормят тебя".
    expect((await read('— Однако, плохо же кормят тебя твои хозяева!', 'Однако'))[1]).toBe('however');
  });

  it('read Здравствуйте and Прощай as greetings, not imperatives', async () => {
    expect(await read('— Здравствуйте, — говорит.', 'Здравствуйте')).toEqual(['здравствуйте', 'hello']);
    expect((await read('Батюшка сказал мне: «Прощай, Петр.', 'Прощай'))[0]).toBe('прощай');
  });
});

describe('the re-audit: verbs and short adjectives', () => {
  it('read a -ся verb with its own entry as that verb', async () => {
    expect((await read('Он хотел проститься с хозяином, но его не пустили.', 'проститься'))[0]).toBe('проститься');
    expect((await read('«Барин, не прикажешь ли воротиться?»', 'воротиться'))[0]).toBe('воротиться');
  });

  it('read a short adjective after its subject or a linking verb as the predicate', async () => {
    expect((await read('Итак, вы понимаете, читатель, каким образом я знаком со всем Петербургом.', 'знаком'))[0]).toBe('знакомый');
    expect((await read('Добро бы на свадьбу!» Савельич был прав.', 'прав'))[0]).toBe('правый');
    expect((await read('Новый мир был велик и полон яркого света.', 'велик'))[1]).toBe('big');
    expect((await read('Спрашивает, хорош ли, молод ли жилец?', 'хорош'))[0]).toBe('хороший');
    // Not a word that is an adverb or a verb too: "мне стало стыдно", "она пошла за ним" (Kashtanka).
    expect((await read('Так что наконец мне стало стыдно, обидно и грустно.', 'стыдно'))[0]).toBe('стыдно');
    expect((await read('Тётке жутко было оставаться в потёмках, и она пошла за ним.', 'пошла'))[0]).toBe('пойти');
  });

  it('read a verb in the first person as the noun where the clause has its verb', async () => {
    expect((await read('— Время ненадежно: ветер слегка подымается; — вишь, как он сметает порошу.', 'порошу'))[0]).toBe('пороша');
    expect((await read('Я отвернулся и сказал ему: «Поди вон, Савельич; я чаю не хочу».', 'чаю'))[0]).toBe('чай');
    expect((await read('— Дорога-то здесь; я стою на твердой полосе, — отвечал дорожный, — да что толку?', 'толку'))[0]).toBe('толк');
    // A genitive plural that nothing governs, opening its clause, is the verb: The Overcoat.
    expect((await read('Приходя домой, он садился тот же час за стол, хлебал наскоро свои щи.', 'хлебал'))[0]).toBe('хлебать');
  });
});

describe('the re-audit: case', () => {
  it('reads the case a preposition takes', async () => {
    expect((await read('Батюшка за ворот приподнял его с кровати.', 'ворот'))[0]).toBe('ворот');
    expect((await read('Если бы даже директор был так милостив, что, вместо сорока рублей наградных, определил бы сорок пять.', 'сорока'))[0])
      .toBe('сорок');
  });

  it('reads the genitive after нет, a noun or before "не было"', async () => {
    expect((await read('Когда она опомнилась, музыка уже не играла и полка не было.', 'полка'))[0]).toBe('полк');
    expect((await read('«Ваше благородие, прикажите поднести стакан вина; чай не наше казацкое питье».', 'вина'))[0]).toBe('вино');
    expect((await read('Сначала он дал ей хлеба и зелёную корочку сыра, потом кусочек мяса.', 'сыра'))[0]).toBe('сыр');
    expect((await read('Он был лет сорока, росту среднего, худощав и широкоплеч.', 'сорока'))[0]).toBe('сорок');
    // But a verb after its subject stays the verb, and a noun stays a noun: "На шестой день лев умер" (Tolstoy).
    expect((await read('Гусь не шевельнулся. Хозяин сел перед ним на полу.', 'сел'))[0]).toBe('сесть');
    expect((await read('На шестой день лев умер.', 'лев'))[0]).toBe('лев');
  });

  it('reads the noun that agrees with the adjective or determiner before it', async () => {
    expect((await read('Длинный подъезд этого дома с тремя стеклянными дверями был освещён.', 'дома'))[0]).toBe('дом');
    expect((await read('И я не отгоню вас от себя до самого дома.', 'самого'))[0]).toBe('самый');
    expect((await read('И я не отгоню вас от себя до самого дома.', 'дома'))[0]).toBe('дом');
    expect((await read('Вероятно, дворовые служанки еще доканчивают свои толки и разговоры.', 'толки'))[0]).toBe('толк');
    // An instrumental agrees with no nominative: дорогою is "on the way", задел the verb.
    expect((await read('Дорогою задел его всем нечистым своим боком трубочист.', 'задел'))[0]).toBe('задеть');
    expect((await read('Дорогою задел его всем нечистым своим боком трубочист.', 'нечистым'))[1]).toBe('dirty');
    expect((await read('В этот раз бабушка не посылала, а мне самой надо было за чем-то.', 'самой'))[0]).toBe('сам');
    // A participle known only in the masculine shows its case by its ending.
    expect((await read('Тётка проснулась, вскочила и, не сходя с матрасика, залилась воющим лаем.', 'лаем'))[0]).toBe('лай');
  });

  it('reads an adjective with no noun as the noun made of it', async () => {
    expect((await read('Он хотел проститься с хозяином, но его не пустили, говоря, что надо выпить по бокалу шампанского.', 'шампанского'))[0])
      .toBe('шампанское');
    expect((await read('Однажды осенью матушка варила в гостиной медовое варенье.', 'гостиной'))[0]).toBe('гостиная');
    expect((await read('Дорога моя шла по набережной канала, на которой в этот час не встретишь живой души.', 'набережной'))[0])
      .toBe('набережная');
    expect((await read('Она стояла, облокотясь на перила набережной, и не слыхала, как я подошел к ней.', 'набережной'))[0])
      .toBe('набережная');
    expect((await read('Я тотчас же пошел вслед за ней, но она догадалась, оставила набережную, перешла через улицу.', 'набережную'))[0])
      .toBe('набережная');
    // Not before more adjectives, after the noun it is said of, or after a pronoun.
    expect((await read('Старуха, сказав что-то, впустила чёрную, очень некрасивую свинью.', 'чёрную'))[0]).toBe('черный');
    expect((await read('Твоя рука холодная, моя горячая как огонь.', 'холодная'))[0]).toBe('холодный');
    expect((await read('— Сторона мне знакомая, — отвечал дорожный.', 'знакомая'))[0]).toBe('знакомый');
  });
});

describe('the re-audit: все, несколько, свет, чего', () => {
  it('reads все before a participle as "all", before a plural verb past a phrase as "everyone", after a subject as "still"', async () => {
    expect((await read('Она вдруг выкажет всю мощь свою, все дарованные ей небом силы.', 'все'))[1]).toBe('all');
    expect((await read('Все в ту же минуту выбежали в швейцарскую смотреть новую шинель Акакия Акакиевича.', 'Все'))[1]).toBe('everyone');
    expect((await read('Я утешал ее, но она не могла перестать; она все жала мне руку и говорила между рыданьями.', 'все'))[1])
      .toBe('still, all the time');
    // A short participle after it is said of всё.
    expect((await read('Ну, теперь все сказано!', 'все'))[1]).toBe('everything');
  });

  it('reads несколько as "several" before a noun and "somewhat" before an adjective or verb', async () => {
    const overcoat = 'Чиновник нельзя сказать чтобы очень замечательный, низенького роста, несколько рябоват, несколько рыжеват.';
    expect((await read(overcoat, 'несколько'))[1]).toBe('somewhat');
    expect((await read('И, повторив несколько раз слово «Тётка», он вышел.', 'несколько'))[1]).toBe('several, a few');
    expect((await read('Проделав ещё несколько подобных неважных фокусов, незнакомец вдруг схватил себя за голову.', 'несколько'))[1])
      .toBe('several, a few');
    expect((await read('Он уже минут через несколько, весь закрасневшись, начал уверять.', 'несколько'))[1]).toBe('several, a few');
  });

  it('reads свет as the world on it, round it and at its end, and the light elsewhere', async () => {
    expect((await read('Это значит, что вы его больше всего на свете любите.', 'свете'))[1]).toBe('world');
    expect((await read('Один корабль обошел вокруг света и возвращался домой.', 'света'))[1]).toBe('world');
    expect((await read('Огонек в будке, которая казалась стоявшею на краю света.', 'света'))[1]).toBe('world');
    expect((await read('Яркий свет ударил Тётку по глазам.', 'свет'))[1]).toBe('light');
  });

  it('reads чего after a preposition or opening a relative clause as что', async () => {
    expect((await read('Что, наконец, и все, чего я требую, состоит в том только.', 'чего'))[0]).toBe('что');
    expect(await read('— Чего вы боитесь?', 'Чего')).toEqual(['чего', 'what; why']);
  });
});

describe('the re-audit: forms the dictionary leaves out, hints and phrases', () => {
  it('reads participles and diminutives as the forms the dictionary has', async () => {
    expect((await read('Знаете ли, это было так хорошо сказано, что у меня тотчас же мелькнула мысль.', 'сказано'))[0]).toBe('сказать');
    expect((await read('Матушка была еще мною брюхата, как уже я был записан в Семеновский полк сержантом.', 'записан'))[0]).toBe('записать');
    expect((await read('В полиции сделано было распоряжение поймать мертвеца.', 'сделано'))[0]).toBe('сделать');
    expect((await read('Она вдруг выкажет всю мощь свою, все дарованные ей небом силы.', 'дарованные'))[0]).toBe('даровать');
    expect((await read('Новый хозяин вернулся, держа в руках маленький матрасик.', 'матрасик'))[0]).toBe('матрас');
    expect((await read('Она взяла синенькую чашечку на колена и стала есть.', 'синенькую'))[0]).toBe('синий');
    // The stress stays where the long form has it: ска́зано, матра́сик.
    const ru = await loadLang('ru');
    expect(tok(ru, 'Ну, теперь все сказано!', 'сказано').stress).toBe(2);
    expect(tok(ru, 'Новый хозяин вернулся, держа в руках маленький матрасик.', 'матрасик').stress).toBe(4);
  });

  it('give the hints a reader of these books needs', async () => {
    const hints: [string, string, string][] = [
      ['— Барин, не прикажешь ли воротиться?', 'Барин', 'master, gentleman'],
      ['А немного погодя явилась старуха и вынесла корытце.', 'явилась', 'to appear, show up'],
      ['Обыкновенно вечерами хозяин уезжал куда-то.', 'куда-то', 'somewhere'],
      ['Сердце так билось, что в голове больно было.', 'билось', 'to beat, to fight'],
      ['Прачка Палашка, толстая и рябая девка.', 'девка', 'girl, wench'],
      ['Петрович взял капот, разложил его сначала на стол.', 'капот', 'housecoat, hood'],
      ['Он заметил человека небольшого роста в старом поношенном вицмундире.', 'роста', 'height, growth'],
      ['Молодая рыжая собака — помесь такса с дворняжкой.', 'такса', 'dachshund'],
    ];
    for (const [text, word, hint] of hints) expect((await read(text, word))[1]).toBe(hint);
  });

  it('read the fixed phrases as the book means them', async () => {
    expect((await read('— А ведь это Каштанка!', 'ведь'))[1]).toBe('but after all');
    expect((await read('Здравствуйте; как ваше здоровье?', 'здоровье'))[1]).toBe('your health');
    expect((await read('Так продолжал он с давних пор, и таким образом в продолжение нескольких лет оказалось накопившейся суммы.', 'продолжение'))[1])
      .toBe('during');
    expect((await read('К тому же не был он и врагом бутылки, т. е. (говоря по-русски) любил хлебнуть лишнее.', 'т.'))[1]).toBe('that is');
    expect((await read('Надел шапку, взял под мышку какую-то деревянную штуку.', 'мышку'))[1]).toBe('under the arm');
    expect((await read('И прежде всего бросился в глаза большой палец, очень известный Акакию Акакиевичу.', 'палец'))[1]).toBe('thumb, big toe');
  });
});
