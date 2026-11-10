// Small EPUBs shaped like Project Gutenberg books that imported badly. Each copies only the structure of a real book (where
// its header, footer, title page, contents and chapter marks sit, and how they are marked up); every line of text is made up.
//   kafka      pg22367 Die Verwandlung: a title page set in capitals
//   bovary     pg14155 Madame Bovary: an author page, a title page with "(1857)" and a contents heading, a contents label run
//              together ("PREMIÈRE PARTIE I II III …") as the title of the dedication
//   casmurro   pg55752 Dom Casmurro: each chapter's number as a heading of its own before the heading the contents points at
//   pinocchio  pg52484 Pinocchio: a long title page with a picture after INDICE, and the INDICE as a table of links at the end
//   quijote    pg2000 Don Quijote: the contents as a list of links inside the title-page file
//   pride      pg1342 Pride and Prejudice: drop-cap pictures, captions inside headings, a line of links, a list of illustrations
//   nahan      pg27166 吶喊: a text conversion with lines marked h5, the Credits line near the wrap width, the license as a chapter
//   xiyouji    pg23962 西遊記: a text conversion over several files whose 第N回 lines are plain paragraphs
//   rashomon   pg1982 羅生門: a credit before the first contents entry, an English note, a story in one <p> with indents
//   reader     pg15353 A First Spanish Reader: a title page, a real preface and the contents in one chapter
import type { Files } from '../../../import/helpers';
import { CONTAINER, PNG, navDoc, ncxDoc, opf, xhtml } from '../../../import/helpers';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Gutenberg's header as its ebookmaker writes it, with the START line inside. `credit` is the Credits line's text. */
export function pgHeader(title: string, credit = 'Produced by A. Volunteer', language = 'English'): string {
  return `<header class="pg-boilerplate pgheader" id="pg-header" lang="en"><h2 id="pg-header-heading" title="">The Project Gutenberg eBook of ${esc(title)}</h2>
<div>This eBook is for the use of anyone anywhere in the United States and
most other parts of the world at no cost and with almost no restrictions
whatsoever.</div>
<div class="container" id="pg-machine-header"><p><strong>Title</strong>: ${esc(title)}</p>
<p><strong>Release date</strong>: May 1, 2008 [eBook #00000]</p>
<p><strong>Language</strong>: ${language}</p>
<p><strong>Credits</strong>: ${esc(credit)}</p>
</div><div id="pg-start-separator">
<span>*** START OF THE PROJECT GUTENBERG EBOOK ${esc(title)} ***</span>
</div></header>`;
}

/** Gutenberg's footer: the END line and the license under its own heading. */
export function pgFooter(title: string): string {
  return `<footer class="pg-boilerplate pgheader" id="pg-footer" lang="en"><div id="pg-end-separator">
<span>*** END OF THE PROJECT GUTENBERG EBOOK ${esc(title)} ***</span></div>
<h2 id="pg-footer-heading">THE FULL PROJECT GUTENBERG™ LICENSE</h2>
<p>To protect the Project Gutenberg™ mission of promoting the free distribution of electronic works, by using or
distributing this work, you agree to comply with all the terms of the Full Project Gutenberg™ License.</p>
<p>Section 1. General Terms of Use and Redistributing Project Gutenberg™ electronic works.</p>
<p>Project Gutenberg™ is synonymous with the free distribution of electronic works in formats readable by the widest variety of computers.</p>
</footer>`;
}

const LICENSE = 'THE FULL PROJECT GUTENBERG™ LICENSE';

/** A package with these files in spine order (all under OEBPS/), an NCX and a nav made from `toc` ([href, label]). */
function book(o: { title: string; author: string; lang: string; docs: [string, string][]; toc: [string, string][]; images?: string[] }): Files {
  const manifest: [string, string, string, string?][] = [
    ...o.docs.map(([name], i): [string, string, string] => [`d${i}`, name, 'application/xhtml+xml']),
    ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
    ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
    ...(o.images ?? []).map((name, i): [string, string, string] => [`img${i}`, name, 'image/png']),
  ];
  const files: Files = {
    'META-INF/container.xml': CONTAINER(),
    'OEBPS/content.opf': opf({ title: o.title, creators: [o.author], manifest, spine: o.docs.map((_, i) => `d${i}`), spineToc: 'ncx' })
      .replace('<dc:language>zh</dc:language>', `<dc:language>${o.lang}</dc:language>`),
    'OEBPS/toc.ncx': ncxDoc(o.toc),
    'OEBPS/nav.xhtml': navDoc(o.toc),
  };
  for (const [name, body] of o.docs) files[`OEBPS/${name}`] = xhtml(body).replace('<body>', '<body class="x-ebookmaker x-ebookmaker-3">');
  for (const name of o.images ?? []) files[`OEBPS/${name}`] = PNG;
  return files;
}

/** `n` made-up sentences from a pool, as one paragraph. */
function prose(pool: string[], n: number, seed = 0): string {
  return Array.from({ length: n }, (_, i) => pool[(seed + i) % pool.length]).join(' ');
}

const DE = [
  'Am Morgen ging der junge Mann langsam durch die stille Gasse und dachte an die Arbeit, die ihn erwartete.',
  'Die Schwester stand am Fenster, sah auf den Regen hinaus und sagte lange nichts.',
  'Er wusste nicht, wie er der Familie erklären sollte, was in der Nacht geschehen war.',
  'Im Zimmer war es kalt, und die Uhr auf dem Schrank schlug schon sieben.',
];
const FR = [
  'Le matin, le jeune homme traversa la place du village et salua le vieux marchand qui ouvrait sa boutique.',
  'Elle regardait la pluie tomber sur le jardin et pensait à la lettre qu’elle n’avait pas encore écrite.',
  'Il y avait dans la maison une odeur de pain chaud et de bois brûlé que personne ne remarquait plus.',
  'Les enfants couraient dans la cour pendant que leur mère préparait le repas du soir.',
];
const PT = [
  'Naquella manhã o rapaz desceu a rua devagar e pensou na conversa que tivera com a mãe na vespera.',
  'A casa era pequena, mas tinha um quintal com duas laranjeiras e um banco de pedra junto ao muro.',
  'Quando chegou a noite, todos se sentaram à mesa e ninguem quiz fallar do que acontecera.',
  'O velho amigo da familia contava historias antigas que as crianças ouviam com muita attenção.',
];
const IT = [
  'Quella mattina il falegname trovò nella bottega un pezzo di legno che rideva e piangeva come un bambino.',
  'Il vecchio si mise a sedere sulla panca e guardò la strada piena di sole senza dire una parola.',
  'Dopo cena tutti andarono a dormire, ma il ragazzo rimase sveglio a pensare al suo nuovo amico.',
  'La casa era povera e fredda, e sul muro c’era dipinto un fuoco che non scaldava nessuno.',
];
const ES = [
  'En un pueblo pequeño vivía un hidalgo que pasaba los días leyendo libros de caballerías junto a la ventana.',
  'Su sobrina y el ama de la casa no entendían por qué el buen hombre dormía tan poco y hablaba tanto.',
  'Una mañana salió de su casa sin decir nada a nadie, montado en un caballo flaco y viejo.',
  'Por el camino encontró a un labrador vecino suyo que volvía del molino con dos sacos de harina.',
];
const EN = [
  'It was a fine morning in the country, and the whole family was gathered in the breakfast room before nine o’clock.',
  'Her mother had spoken of nothing else for a week, and the younger girls were eager to hear more of the news.',
  'He said very little at dinner, but listened to every word with an attention that surprised his friends.',
  'The house stood on a small rise above the village, with a garden that ran down to the river.',
];

/** pg22367 Die Verwandlung: the title page in capitals ("DIE VERWANDLUNG / VON / FRANZ KAFKA / KURT WOLFF VERLAG …"). */
export function kafka(): Files {
  const title = 'Die Reise';
  const page = ['DIE REISE', 'VON', 'HANS MUSTER', 'KURT BEISPIEL VERLAG', 'LEIPZIG', '1917'].map((l, i) => (i ? `<p>${l}</p>` : `<h1>${l}</h1>`)).join('');
  const chapter = (id: string, head: string, seed: number) => `<h2 id="${id}">${head}</h2>` + [0, 1, 2].map((k) => `<p>${prose(DE, 3, seed + k)}</p>`).join('');
  return book({
    title, author: 'Hans Muster', lang: 'de',
    docs: [['k-0.htm.xhtml', pgHeader(title) + page + chapter('c1', 'I.', 0) + chapter('c2', 'II.', 1)], ['k-1.htm.xhtml', pgFooter(title)]],
    toc: [['k-0.htm.xhtml#pg-header-heading', title], ['k-0.htm.xhtml#c1', 'I.'], ['k-0.htm.xhtml#c2', 'II.'], ['k-1.htm.xhtml#pg-footer-heading', LICENSE]],
  });
}

/**
 * pg14155 Madame Bovary, a text conversion: an author page, then "MADAME BOVARY / (1857) / Table des matières", then the
 * dedication under an h4 that runs the contents together, then the parts (h5) and chapters (h2).
 */
export function bovary(): Files {
  const title = 'Madame Exemple';
  const squashed = 'PREMIÈRE PARTIE I II III DEUXIÈME PARTIE I II III';
  const body = pgHeader(title, 'Produced by A. Volunteer', 'French')
    + '<h1 id="t0">Gustave Exemple</h1>'
    + `<h1 id="t1">MADAME EXEMPLE</h1><p>(1857)</p><p>Table des matières</p>`
    + `<h4 id="t2">${squashed}</h4><p>À</p><p>Marie-Antoine Exemple</p><p>${prose(FR, 2)}</p><p>Paris, 12 avril 1857</p>`
    + ['PREMIÈRE PARTIE', 'DEUXIÈME PARTIE'].map((part, p) => `<h5 id="p${p}">${part}</h5>` + ['I', 'II', 'III'].map((n, k) =>
      `<h2 id="p${p}c${k}">${n}</h2>` + [0, 1].map((j) => `<p>${prose(FR, 3, p + k + j)}</p>`).join('')).join('')).join('');
  return book({
    title, author: 'Gustave Exemple', lang: 'fr',
    docs: [['b-0-0.txt.xhtml', body], ['b-0-1.txt.xhtml', pgFooter(title)]],
    toc: [
      ['b-0-0.txt.xhtml#t0', title], ['b-0-0.txt.xhtml#t1', 'MADAME EXEMPLE'], ['b-0-0.txt.xhtml#t2', squashed],
      ...['PREMIÈRE PARTIE', 'DEUXIÈME PARTIE'].flatMap((part, p): [string, string][] => [
        [`b-0-0.txt.xhtml#p${p}`, part], ...['II', 'III'].map((n, k): [string, string] => [`b-0-0.txt.xhtml#p${p}c${k + 1}`, n]),
      ]),
      ['b-0-1.txt.xhtml#pg-footer-heading', LICENSE],
    ],
  });
}

/** pg55752 Dom Casmurro: "<hr/><h5>II</h5><h4 id=…>Do livro.</h4>", the contents pointing at the h4; FIM and an INDICE of links. */
export function casmurro(): Files {
  const title = 'Dom Exemplo';
  const names = ['Do titulo.', 'Do livro.', 'A denuncia.', 'Um dever amarissimo!', 'O aggregado.', 'Tio Cosme.'];
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const page = '<h1>DOM EXEMPLO</h1><h3>POR</h3><h2>MACHADO EXEMPLO</h2><h3>DA ACADEMIA BRAZILEIRA</h3><p>H. GARNIER, LIVREIRO-EDITOR</p><p>RIO DE JANEIRO</p><p>1899</p><p><a href="c-1.htm.xhtml#indice" class="pginternal">Indice</a></p>';
  const chapters = names.map((n, i) => `<hr class="chap"/><h5><a id="${roman[i]}">${roman[i]}</a></h5><h4 id="c${i}">${n}</h4><p>${prose(PT, 3, i)}</p><p>${prose(PT, 2, i + 1)}</p>`).join('');
  const indice = '<h4 id="fim">FIM</h4><h4 id="indice">INDICE</h4><table>' + names.map((n, i) =>
    `<tr><td/><td><a href="c-0.htm.xhtml#${roman[i]}" class="pginternal">${roman[i]}</a></td><td>${n}</td></tr>`).join('') + '</table>';
  return book({
    title, author: 'Machado Exemplo', lang: 'pt',
    docs: [['c-0.htm.xhtml', pgHeader(title, 'Produced by A. Volunteer', 'Portuguese') + page + chapters], ['c-1.htm.xhtml', indice + pgFooter(title)]],
    toc: [...names.map((n, i): [string, string] => [`c-0.htm.xhtml#c${i}`, n]), ['c-1.htm.xhtml#fim', 'FIM'], ['c-1.htm.xhtml#indice', 'INDICE'], ['c-1.htm.xhtml#pg-footer-heading', LICENSE]],
  });
}

/** A long chapter title, as Pinocchio's run (to 191 characters): it is never cut short. */
export const PINOCCHIO_LONG_TITLE = 'III. Il falegname, tornato a casa, comincia subito a fabbricarsi il burattino e gli mette il nome di Legnetto; poi gli insegna a camminare e a stare composto davanti alla gente del paese.';

/** pg52484 Pinocchio: a title page of 19 blocks with its frontispiece after INDICE, one file per chapter, an INDICE of links at the end. */
export function pinocchio(): Files {
  const title = 'Le avventure di Legnetto';
  const page = ['<h1>LE AVVENTURE DI LEGNETTO</h1>', '<hr/>', '<p>C. ESEMPIO</p>', '<p>Le avventure di Legnetto</p>', '<p>STORIA DI UN BURATTINO</p>',
    '<p>ILLUSTRATA DA E. PITTORE</p>', '<hr/>', '<p>FIRENZE</p>', '<p>R. Bemporad &amp; Figlio — Editori.</p>', '<p>Via del Proconsolo, 7</p>', '<p>1902</p>',
    '<hr/>', '<p>PROPRIETÀ LETTERARIA</p>', '<p>12 — 1902. — Tip. di Salvadore Landi, Firenze.</p>', '<hr/>', '<p>INDICE</p>', '<hr/>',
    '<p><img src="front.png" alt=""/></p>'].join('');
  const titles = ['I. Come andò che il falegname trovò un pezzo di legno che piangeva e rideva come un bambino.',
    'II. Il falegname regala il pezzo di legno al suo amico, il quale lo prende per fabbricarsi un burattino.', PINOCCHIO_LONG_TITLE];
  const chapter = (i: number) => `<h2 id="c${i}">${titles[i]}</h2>` + [0, 1, 2].map((k) => `<p>${prose(IT, 3, i + k)}</p>`).join('');
  const indice = '<h2 id="indice">INDICE</h2><table class="indice">' + titles.map((t, i) =>
    `<tr><td>${['I', 'II', 'III'][i]}</td><td><a href="p-${i + 1}.htm.xhtml#c${i}" class="pginternal">${t.replace(/^[IVX]+\. /, '')}</a></td><td>Pag. ${5 + i * 7}</td></tr>`).join('')
    + '</table><h3>Nota del Trascrittore</h3><p>Ortografia e punteggiatura originali sono state mantenute, correggendo senza annotazione minimi errori tipografici.</p>';
  return book({
    title, author: 'C. Esempio', lang: 'it',
    docs: [['p-0.htm.xhtml', pgHeader(title, 'Produced by A. Volunteer', 'Italian') + page], ...titles.map((_, i): [string, string] => [`p-${i + 1}.htm.xhtml`, chapter(i)]),
      ['p-4.htm.xhtml', indice + pgFooter(title)]],
    toc: [['p-0.htm.xhtml#pg-header-heading', 'LE AVVENTURE DI LEGNETTO'], ...titles.map((t, i): [string, string] => [`p-${i + 1}.htm.xhtml#c${i}`, t]),
      ['p-4.htm.xhtml#indice', 'INDICE'], ['p-4.htm.xhtml#pg-footer-heading', LICENSE]],
    images: ['front.png'],
  });
}

/** pg2000 Don Quijote: the title, the author, then a list of links to every chapter, in the first file. */
export function quijote(): Files {
  const title = 'Don Exemplo';
  const heads = ['Capítulo primero. Que trata de la condición y ejercicio del famoso hidalgo don Exemplo de la Mancha',
    'Capítulo II. Que trata de la primera salida que de su tierra hizo el ingenioso don Exemplo',
    'Capítulo III. Donde se cuenta la graciosa manera que tuvo don Exemplo en armarse caballero',
    'Capítulo primero. De lo que el cura y el barbero pasaron con él sobre su enfermedad',
    'Capítulo II. Que trata de la notable pendencia que Sancho tuvo con la sobrina y el ama',
    'Capítulo III. Del ridículo razonamiento que pasó entre don Exemplo, Sancho y el bachiller'];
  const list = (from: number, to: number) => '<ul class="toc">' + heads.slice(from, to).map((h, i) =>
    `<li><a href="q-2.htm.xhtml#c${from + i}" class="pginternal">${h.replace(/^Capítulo [^.]+\. /, '')}</a></li>`).join('') + '</ul>';
  const first = pgHeader(title, 'Produced by A. Volunteer', 'Spanish')
    + `<h1>El ingenioso hidalgo don Exemplo de la Mancha</h1><h2 id="t">por Miguel Ejemplo Saavedra</h2><hr/>`
    + `<p>El ingenioso hidalgo don Exemplo de la Mancha</p>${list(0, 3)}<p>Segunda parte del ingenioso caballero don Exemplo de la Mancha</p>${list(3, 6)}`;
  const tasa = `<h3 id="tasa">TASA</h3><p>${prose(ES, 2)}</p><p>Juan Ejemplo de Andrada.</p>`;
  const chapters = heads.map((h, i) => `<h2 id="c${i}">${h}</h2>` + [0, 1].map((k) => `<p>${prose(ES, 3, i + k)}</p>`).join('')).join('');
  return book({
    title, author: 'Miguel Ejemplo Saavedra', lang: 'es',
    docs: [['q-0.htm.xhtml', first], ['q-1.htm.xhtml', tasa], ['q-2.htm.xhtml', chapters + pgFooter(title)]],
    toc: [['q-0.htm.xhtml#t', 'por Miguel Ejemplo Saavedra'], ['q-1.htm.xhtml#tasa', 'TASA'], ...heads.map((h, i): [string, string] => [`q-2.htm.xhtml#c${i}`, h]),
      ['q-2.htm.xhtml#pg-footer-heading', LICENSE]],
  });
}

/**
 * pg1342 Pride and Prejudice: a line of links ("PREFACE. / List of Illustrations. / Chapter: I., II., …"), a title page, a
 * preface, a list of illustrations whose page numbers are the links, headings with a picture and its caption before
 * "CHAPTER II.", and paragraphs that open on a letter drawn as a picture (one with the quote mark before it).
 */
export function pride(): Files {
  const title = 'Pride and Exemple';
  const toc = `<p class="toc"><a href="e-0.htm.xhtml#PREFACE" class="pginternal">PREFACE.</a><br/><a href="e-0.htm.xhtml#LOI" class="pginternal">List of Illustrations.</a><br/>`
    + `<a href="e-0.htm.xhtml#c1" class="pginternal">Chapter: I., </a><a href="e-0.htm.xhtml#c2" class="pginternal">II., </a><a href="e-0.htm.xhtml#c3" class="pginternal">III.</a></p>`;
  const front = `<div class="figcenter"><img alt="[Colophon: A PUBLISHER, LONDON]" src="colophon.png"/></div>`
    + `<h1 id="t"><img alt="" src="front.png"/><br/><i>PRIDE.<br/>and<br/>EXEMPLE</i></h1><p class="cbig"><i>by<br/>Jane Exemple,<br/></i></p>`
    + `<h2 id="PREFACE"><img alt="PREFACE." src="preface.png"/></h2>` + [0, 1, 2].map((k) => `<p>${prose(EN, 4, k)}</p>`).join('')
    + `<h2 id="LOI"><img alt="List of Illustrations." src="loi.png"/></h2><table><tr><td> </td><td><small>PAGE</small></td></tr>`
    + ['Frontispiece', 'Title-page', 'Heading to Chapter I.', '“He came down to see the place”', 'Mr. and Mrs. Exemple', '“I hope he will like it”'].map((c, i) =>
      `<tr><td>${c}</td><td class="rtb"><a href="e-0.htm.xhtml#page_${i + 1}" class="pginternal">${i + 1}</a></td></tr>`).join('') + '</table>';
  const ch1 = `<h2 id="c1"><img alt="" src="h1.png"/><br/>Chapter I.</h2><p>IT is a truth ${prose(EN, 2, 1)}</p><p>${prose(EN, 3, 2)}</p>`;
  const ch2 = `<h2 id="c2">\n<img alt="" src="h2.png"/>\n<span class="caption">\nI hope he will like it.\n</span>\n<br/>\n<br/>\nCHAPTER II.\n</h2>`
    + `<p class="nind"><span class="letra">\n<img alt="M" src="m.png"/></span>R. BENNET was among the earliest of those who called on the new neighbour, ${prose(EN, 1, 3)}</p><p>${prose(EN, 3, 0)}</p>`;
  const ch3 = `<h2 id="c3"><img alt="" src="h3.png"/><span class="caption">He rode a black horse.</span><br/><br/>CHAPTER III.</h2>`
    + `<p class="nind">“<span class="letra"><img alt="I" src="i.png"/></span> HAVE been thinking it over again,” said her uncle, ${prose(EN, 1, 2)}</p><p>${prose(EN, 3, 1)}</p>`;
  return book({
    title, author: 'Jane Exemple', lang: 'en',
    docs: [['e-0.htm.xhtml', pgHeader(title) + '<div/><hr class="full"/><div class="blk">' + toc + '</div>' + front + ch1 + ch2 + ch3 + pgFooter(title)]],
    toc: [['e-0.htm.xhtml#t', 'PRIDE. and EXEMPLE'], ['e-0.htm.xhtml#c1', 'Chapter I.'], ['e-0.htm.xhtml#c2', 'I hope he will like it. CHAPTER II.'],
      ['e-0.htm.xhtml#c3', 'He rode a black horse. CHAPTER III.'], ['e-0.htm.xhtml#pg-footer-heading', LICENSE]],
    images: ['colophon.png', 'front.png', 'preface.png', 'loi.png', 'h1.png', 'h2.png', 'h3.png', 'm.png', 'i.png'],
  });
}

const ZH = ['城外的小河', '靜靜地流著', '岸邊的柳樹', '在風里搖動', '他慢慢走過', '那座舊石橋', '心里想起了', '從前的朋友', '天色漸漸暗', '遠處有燈光'];

/** Made-up Chinese, hard-wrapped at `width` characters with commas inside every line, as one printed line per <p>. */
function zhLines(n: number, width: number, seed: number): string[] {
  const lines: string[] = [];
  let k = seed;
  for (let i = 0; i < n; i++) {
    let line = '';
    while ([...line].length < width) line += ZH[k++ % ZH.length] + '，';
    lines.push([...line].slice(0, width).join(''));
  }
  // The paragraph ends on a short line that ends a sentence.
  lines.push('大家都沒有說話。');
  return lines;
}

/**
 * pg27166 吶喊, a text conversion: the header's Credits line just under the wrap width, then the book one printed line per
 * <p> (indented with ASCII spaces), lines with a capital letter set as h5 mid-sentence (and the contents pointing at one), a
 * "第一回是…" sentence, and the license as the last contents entry. `frame`: Gutenberg's header and footer marked up as they
 * are now; without it, as plain lines, as in older files.
 */
export function nahan(frame = true): Files {
  const title = '吶喊';
  // "Credits: Produced by Han Huei Haung" is 35 characters, one under the width the book is wrapped at.
  const credit = 'Produced by Han Huei Haung';
  const header = frame ? pgHeader(title, credit, 'Chinese')
    : `<p>Credits: ${credit}</p><p>*** START OF THE PROJECT GUTENBERG EBOOK ${title} ***</p>`;
  const footer = frame ? pgFooter(title) : `<p>*** END OF THE PROJECT GUTENBERG EBOOK ${title} ***</p><h2>${LICENSE}</h2><p>Project Gutenberg™ is synonymous with the free distribution of electronic works.</p>`;
  const p = (l: string, id?: string) => `<p${id ? ` id="${id}"` : ''}>    ${l}</p>\n\n`;
  const part = (seed: number, h5At: number) => zhLines(14, 36, seed).map((l, i) => (i === h5At ? `<h5 id="h${seed}">    S城${l.slice(2)}</h5>\n\n` : p(l))).join('');
  const doc0 = header + p('Produced by Han Huei Haung') + p('《魯迅︰吶喊》') + part(0, 5) + part(3, 9)
    + p('第一回是民國元年我初到北京的時候，當時一個朋友對我說，北京戲最好，你') + p('不去見見世面麼？我想，看戲是有味的，而況在北京呢。于是都興致勃勃的跑') + p('到什麼園。');
  const doc1 = part(5, 2) + part(7, 11) + part(2, 4);
  return book({
    title, author: 'Xun Lu', lang: 'zh',
    docs: [['n-0-0.txt.xhtml', doc0], ['n-0-1.txt.xhtml', doc1], ['n-0-2.txt.xhtml', footer]],
    toc: [['n-0-0.txt.xhtml#h0', 'S城' + zhLines(1, 36, 0)[0].slice(2)], ['n-0-2.txt.xhtml#pg-footer-heading', LICENSE]],
  });
}

const HAN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const hanNumber = (n: number) => (n === 100 ? '一百' : n < 10 ? HAN_NUM[n] : `${n >= 20 ? HAN_NUM[Math.floor(n / 10)] : ''}十${HAN_NUM[n % 10]}`);

/** pg23962 西遊記, a text conversion over several files: "Language: Chinese" after the header, 100 第N回 lines as plain <p>. */
export function xiyouji(): Files {
  const title = '西遊記';
  const hui = (n: number) => `<p style="margin-top: 4em">第${hanNumber(n)}回     某山某水某人來　某時某地某事成</p>\n`
    + `<p style="margin-top: 2em">${zhLines(3, 36, n).join('\n')}</p>\n`;
  const files: [string, string][] = [];
  for (let f = 0; f < 4; f++) {
    let body = f === 0 ? pgHeader(title, 'Produced by A. Volunteer', 'Chinese') + '<p id="id00000">Language: Chinese</p>\n' : '';
    for (let n = f * 25 + 1; n <= f * 25 + 25; n++) body += hui(n);
    files.push([`x-0-${f}.txt.xhtml`, body]);
  }
  files.push(['x-0-4.txt.xhtml', pgFooter(title)]);
  return book({ title, author: "Cheng'en Wu", lang: 'zh', docs: files, toc: [['x-0-4.txt.xhtml#pg-footer-heading', LICENSE]] });
}

const JA = ['或日の暮方の事である', '一人の男が門の下で', '雨やみを待っていた', '広い門の下には誰もいない', 'ただ大きな円柱に', '蟋蟀が一匹とまっている'];

/** The paragraphs of the made-up story in the 羅生門 shape (each an indent in the source). */
export const RASHOMON_PARAGRAPHS = 6;

/**
 * pg1982 羅生門: "Produced by" before the first contents entry, the entry (RASHOMON) on an h1, an English note, the Japanese
 * title and author, then the whole story in one <p>: lines hard-wrapped with source line breaks, each paragraph opening with
 * U+3000, one more after a sentence end in mid-line.
 */
export function rashomon(): Files {
  const title = '雨の門';
  const paras: string[] = [];
  for (let i = 0; i < RASHOMON_PARAGRAPHS - 1; i++) {
    let text = '　';
    for (let k = 0; k < 8; k++) text += JA[(i + k) % JA.length] + (k % 3 === 2 ? '。' : '、');
    paras.push(text.replace(/、$/, '。'));
  }
  // The last paragraph starts after a sentence end in mid-line (待っていた。　広い門).
  paras[paras.length - 1] += '　' + JA.join('、') + '。';
  const wrapped = paras.map((p) => [...p].reduce((lines: string[], c, i) => { if (i % 20 === 0) lines.push(''); lines[lines.length - 1] += c; return lines; }, []).join('\n')).join('\n');
  const body = pgHeader(title, 'Produced by Rick Volunteer', 'Japanese') + '<p id="id00000">Produced by Rick Volunteer</p>'
    + '<h1 id="id00001" style="margin-top: 13em">AME NO MON</h1><p>By EXAMPLE Ryunosuke</p><p>A note from the digitizer</p>'
    + '<p>This file is encoded in Japanese. Your computer must be Japanese-capable\nto read it.</p>'
    + `<p style="margin-top: 4em">${title}</p><p>芥川例之介</p><p id="id00008">${wrapped}</p>`;
  return book({
    title, author: 'Ryunosuke Example', lang: 'ja',
    docs: [['r-0-0.txt.xhtml', body], ['r-0-1.txt.xhtml', pgFooter(title)]],
    toc: [['r-0-0.txt.xhtml#id00001', 'AME NO MON'], ['r-0-1.txt.xhtml#pg-footer-heading', LICENSE]],
  });
}

/** The first words of the preface in the reader shape, which must stay. */
export const READER_PREFACE = 'This little book is meant for pupils who have studied Spanish for a few weeks';

/** pg15353 A First Spanish Reader: the title page, a preface and a contents list of links, all before the first chapter. */
export function reader(): Files {
  const title = 'A First Exemplo Reader';
  const lessons = ['1. LA ESCUELA', '2. EL DISCÍPULO', '3. LA SALA DE CLASE'];
  const first = pgHeader(title, 'Produced by A. Volunteer', 'Spanish')
    + '<h1>A FIRST EXEMPLO READER</h1><h2>WITH QUESTIONS AND VOCABULARY</h2><h2>BY</h2><h2>ERWIN EXEMPLO, PH.D.</h2>'
    + `<h2 id="preface">PREFACE</h2><p>${READER_PREFACE}, and who want to read easy prose from the first day.</p><p>${prose(ES, 3)}</p>`
    + '<h2>CONTENTS</h2><ul>' + lessons.map((l, i) => `<li><a href="s-1.htm.xhtml#l${i}" class="pginternal">${l}</a></li>`).join('') + '</ul>';
  const body = lessons.map((l, i) => `<h2 id="l${i}">${l}</h2>` + [0, 1].map((k) => `<p>${prose(ES, 3, i + k)}</p>`).join('')).join('');
  return book({
    title, author: 'Erwin Exemplo', lang: 'es',
    docs: [['s-0.htm.xhtml', first], ['s-1.htm.xhtml', body + pgFooter(title)]],
    toc: [['s-0.htm.xhtml#preface', 'PREFACE'], ...lessons.map((l, i): [string, string] => [`s-1.htm.xhtml#l${i}`, l]), ['s-1.htm.xhtml#pg-footer-heading', LICENSE]],
  });
}
