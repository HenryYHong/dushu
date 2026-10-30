// Spanish context rules (src/lang/spaced/es-context.ts) on the sentences of Quiroga's Cuentos de la selva, Galdós's Marianela
// and Jiménez's Platero y yo that showed each one wrong: the words whose reading depends on the words around them.
import { describe, expect, it } from 'vitest';
import { loadLang, lookupIn, tok } from './load';

const hintIn = async (sentence: string, word: string, nth = 0): Promise<string | undefined> => {
  const es = await loadLang('es');
  return es.hint(tok(es, sentence, word, nth));
};
const keyIn = async (sentence: string, word: string, nth = 0): Promise<string | undefined> => tok(await loadLang('es'), sentence, word, nth).key;

describe('sí, solo, que', () => {
  it('read sí as "yes" except after a preposition or before mismo', async () => {
    expect(await hintIn('—Sí, señor, estas son las minas de Socartes, aunque estamos un poco lejos del establecimiento.', 'Sí')).toBe('yes');
    expect(await hintIn('—Sí, sí, sí—afirmó la Nela con desvarío—yo soy hermosa, soy muy hermosa.', 'sí')).toBe('yes');
    expect(lookupIn(await loadLang('es'), '—Sí, señor; pero sin duda equivoqué el camino.', 'Sí').entries[0].senses[0].glosses[0]).toMatch(/^yes/);
    expect(await hintIn('Repetidas veces dijo para sí al llenar la escudilla de la Nela:—¡Qué bien me gano mi puestecico en el cielo!', 'sí')).toBe('himself, herself');
    expect(await hintIn('Cuando llovía, Pedrito se encrespaba y se contaba a sí mismo una porción de cosas, muy bajito.', 'sí')).toBe('himself, herself');
  });

  it('read solo as "alone" where an adjective stands, and sólo as "only"', async () => {
    expect(await hintIn('Vivía solo en el bosque, y él mismo se cocinaba.', 'solo')).toBe('alone, single');
    expect(await hintIn('¡Córcholis! Aprenderé solo. ¡Ay!, Nela, dicen', 'solo')).toBe('alone, single');
    expect(await hintIn('Después le sacó el cuero, tan grande que él solo podía servir de alfombra para un cuarto.', 'solo')).toBe('alone, single');
    expect(await hintIn('Volví por las tapias, solo y mustio, entré en la casa por la puerta del corral, y, huyendo de los hombres, me fuí a la cuadra y me senté a llorar con Platero.', 'solo')).toBe('alone, single');
    expect(await hintIn('Sólo los espejos de azabache de sus ojos son duros cual dos escarabajos de cristal negro.', 'Sólo')).toBe('only');
  });

  it('read que after a noun as the relative, and as the conjunction after a subject or a comparison', async () => {
    const es = await loadLang('es');
    const s = 'Había una vez un hombre que vivía en Buenos Aires, y estaba muy contento porque era un hombre sano y trabajador.';
    expect(lookupIn(es, s, 'que').entries[0].senses[0].pos).toBe('pronoun');
    expect(es.hint(tok(es, s, 'que'))).toBe('which, who, that');
    expect(es.hint(tok(es, 'Y no sabes tú que las estrellas bajan?', 'que'))).toBe('that');
    expect(es.hint(tok(es, 'Y no sabes tú que las estrellas bajan?', 'las'))).toBe('the');
    expect(es.hint(tok(es, 'Una olla de algo más vaca que carnero, salpicón las más noches, duelos y quebrantos los sábados, lentejas los viernes, algún palomino de añadidura los domingos, consumían las tres partes de su hacienda.', 'que'))).toBe('than');
    // lo que is "what".
    expect(es.hint(tok(es, '—¡Madre de Dios!—exclamó la Nela, cruzando las manos—. ¿Tendrá eso algo que ver con lo que yo siento?', 'que', 1))).toBe('what, that which');
  });
});

describe('cual', () => {
  it('reads cual as "like" except after an article', async () => {
    expect(await hintIn('Sólo los espejos de azabache de sus ojos son duros cual dos escarabajos de cristal negro.', 'cual')).toBe('like');
    expect(await hintIn('Aquella débil criatura, en la cual parecía que el alma estaba como prensada y constreñida dentro de un cuerpo miserable, se ensanchaba y crecía maravillosamente al hallarse sola con su amo y amigo.', 'cual')).toBe('which');
  });
});

describe('pronouns', () => {
  it('read los and les as the pronouns before a verb', async () => {
    expect(await hintIn('Y el hombre los echó con la escoba.', 'los')).toBe('them');
    expect(await keyIn('—Me los dio D. Teodoro—añadió la Nela—para que me comprara unos zapatos.', 'los')).toBe('los');
    expect(await hintIn('Entonces un tatú que había ido a tomar agua al río, se quiso burlar de los flamencos y les dijo, haciéndoles un gran saludo:', 'les')).toBe('to them');
    expect(await hintIn('Y el hombre los echó con la escoba.', 'escoba')).toBe('broom');
  });

  it('read lo before a word that is a noun or a verb as the pronoun', async () => {
    const es = await loadLang('es');
    const s = 'Lo beso, lo engaño, lo hago rabiar.';
    expect(es.hint(tok(es, s, 'lo', 0))).toBe('it, him');
    expect(tok(es, s, 'engaño').key).toBe('engañar');
    expect(tok(es, 'He aquí que mientras mi hermano lo busca en las entrañas de la tierra, yo lo busco en el interior maravilloso de ese universo en abreviatura que se llama el ojo humano.', 'busca').key).toBe('buscar');
  });
});

describe('reflexive verbs', () => {
  it('read a verb after a reflexive pronoun of its person as reflexive', async () => {
    expect(await hintIn('Pero un día se enfermó, y los médicos le dijeron que solamente yéndose al campo podría curarse.', 'enfermó')).toBe('to become ill');
    expect(await hintIn('En efecto, el vapor estaba lejos todavía cuando se detuvo.', 'detuvo')).toBe('to stop');
    expect(await hintIn('Detúvose, y mirando a todo el círculo del horizonte, parecía impaciente y desasosegado.', 'Detúvose')).toBe('to stop');
    expect(await hintIn('Entonces un tatú que había ido a tomar agua al río, se quiso burlar de los flamencos y les dijo, haciéndoles un gran saludo:', 'burlar')).toBe('to make fun of');
  });

  it('not when the pronoun is of another person, or se is impersonal', async () => {
    expect(await hintIn('Si te parece bien, iremos al bosque que está más allá de Saldeoro.', 'parece')).toBe('to seem');
    expect(await hintIn('—Me los dio D. Teodoro—añadió la Nela—para que me comprara unos zapatos.', 'dio')).toBe('to give');
    expect(await hintIn('No se puede bajar sino de una manera.', 'bajar')).toBe('to go down');
  });

  it('read a form of ser and ir after se, or before a or a gerund, as ir', async () => {
    const s = 'El hombre enfermo aceptó, y se fué a vivir al monte, lejos, más lejos que Misiones todavía.';
    expect(await keyIn(s, 'fué')).toBe('ir');
    expect(await hintIn(s, 'fué')).toBe('to go away');
    expect(await keyIn('Mi padre cayó enfermo, y como mi madre no le quiso asistir, porque era malo, él fue al hospital donde dicen que se murió.', 'fue')).toBe('ir');
    expect(await keyIn('El director reconoció a su amigo, y él mismo fué corriendo a buscar remedios, con los que el cazador se curó en seguida.', 'fué')).toBe('ir');
    // ir going to do something lends its se to the verb after: "se va a morir" is not "goes away".
    expect(await hintIn('Si queda aquí en el monte se va a morir, porque no hay remedios, y tengo que llevarlo a Buenos Aires.', 'va')).toBe('to go');
    expect(await keyIn('Pero entonces fué el hombre quien se enfermó.', 'fué')).toBe('ser');
  });
});

describe('fuera, and an infinitive that is also a noun', () => {
  it('read fuera as "outside" after a verb or before de, and as ser after si', async () => {
    expect(await keyIn('Los yacarés desaparecieron en un instante bajo el agua, y nadaron hacia la orilla donde quedaron hundidos, con la nariz y los ojos únicamente fuera del agua.', 'fuera')).toBe('fuera');
    expect(await hintIn('Un día dicen que subió a limpiar el farol que hay en el puente; puso el cesto sobre el antepecho, yo me salí fuera y caíme al río.', 'fuera')).toBe('outside');
    expect(await keyIn('Las campanas, allá arriba, allá fuera, repican entre las estrellas.', 'fuera')).toBe('fuera');
    expect(await keyIn('Y como él no podía tenerla en su casa, que era muy chica, el director del Zoológico se comprometió a tenerla en el jardín, y a cuidarla como si fuera su propia hija.', 'fuera')).toBe('ser');
  });

  it('read poder, decir as verbs after al or before an infinitive', async () => {
    expect(await keyIn('(Al decir esto, hizo un gesto propio del hombre esforzado que desprecia los peligros).', 'decir')).toBe('decir');
    expect(lookupIn(await loadLang('es'), 'Por fin, sin poder dormir más, me echo, desesperado, de la cama.', 'poder').entries[0].senses[0].pos).toBe('verb');
  });
});

describe('adjectives against nouns and verbs', () => {
  it('read the predicate after estar, muy or tan as the adjective', async () => {
    expect(await keyIn('Pero cuando se acercó a la tortuga, vió que estaba ya herida, y tenía la cabeza casi separada del cuello, y la cabeza colgaba casi de dos o tres hilos de carne.', 'herida')).toBe('herido');
    expect(await keyIn('—Pero yo estoy alegre o estoy triste?', 'alegre')).toBe('alegre');
    expect(await keyIn('Estoy muy alegre y muy triste, las dos cosas a un tiempo.', 'alegre')).toBe('alegre');
    expect(await keyIn('Lo llamo dulcemente: "¿Platero?", y viene a mí con un trotecillo alegre que parece que se ríe, en no sé qué cascabeleo ideal...', 'alegre')).toBe('alegre');
    // A noun stays one: "Más rosas" counts roses.
    expect(await hintIn('Más rosas, más rosas, más rosas.', 'rosas')).toBe('rose');
  });

  it('read a participle that agrees as the adjective before its noun, and the noun as an object', async () => {
    expect(await hintIn('Eso lo dicen la fe y la razón, querida Nela.', 'querida')).toBe('dear');
    expect(await hintIn('Sí, señor; y como ahora el médico anunció a su hermano que iba a venir, su hermano le escribió diciéndole que trajera las herramientas para ver si le podía dar vista a Pablo.', 'vista')).toBe('sight');
    // tener puesta: the participle, not puesta "clutch".
    expect(await keyIn('Había por allí un bebedero sombrío, y unos muchachos traidores le tenían puesta una red a los pájaros.', 'puesta')).toBe('poner');
  });

  it('read a subjunctive beside an adjective as the adjective, but not after mientras', async () => {
    const s = 'Había también agarrado vivas muchas víboras venenosas, y las llevaba dentro de un gran mate, porque allá hay mates tan grandes como una lata de kerosene.';
    expect(await hintIn(s, 'vivas')).toBe('alive');
    expect(await keyIn(s, 'mate')).toBe('mate');
    expect(await keyIn(s, 'mates')).toBe('mate');
    expect(await keyIn('Yo te juro que te querré mientras viva, ciego o con vista, y que estoy dispuesto a jurarte delante de Dios un amor grande, insaciable, eterno.', 'viva')).toBe('vivir');
  });

  it('read the adjective between a determiner and a noun, and the noun after one with no noun after it', async () => {
    expect(await hintIn('El Surubí, al oir esto, pensó un largo rato.', 'largo')).toBe('long');
    expect(await hintIn('Sólo los flamencos, que entonces tenían las patas blancas, y tienen ahora como antes la nariz muy gruesa y torcida, sólo los flamencos estaban tristes, porque como tięnen muy poca inteligencia, no habían sabido cómo adornarse.', 'flamencos')).toBe('flamingo; Fleming');
    expect(await hintIn('Y una noche de lluvia estaba el hombre leyendo en su cuarto, muy contento porque acababa de componer el techo de paja, que ahora no se llovía más; estaba leyendo ouando oyó que llamaban.', 'cuarto')).toBe('room, quarter');
    expect(await hintIn('Mi padre fue el primero que encendió las luces en Villamojada.', 'primero')).toBe('first');
    expect(await hintIn('—Difícil es—exclamó—detener una gota de agua que resbala, que resbala ¡ay!, por la pendiente abajo y está ya a dos pulgadas del Océano; pero lo intentaré.', 'pendiente')).toBe('slope');
  });

  it('read a plural adjective form with no noun as the noun spelled alike', async () => {
    expect(await hintIn('—¡Tán - tán!— Tiene medias coloradas, blancas y negras?', 'medias')).toBe('stockings');
    expect(await hintIn('—¡Tán - tán!— Tiene medias coloradas, blancas y negras?', 'coloradas')).toBe('red, colored');
  });
});

describe('Spanish hints the books showed wrong', () => {
  it('give dialogue verbs, Quiroga\'s animals and fixed phrases their sense', async () => {
    expect(await hintIn('—Ese ruido que usted siente—replicó el ciego deteniéndose—y que parece... ¿cómo lo diré?', 'replicó')).toBe('to reply, retort');
    expect(await hintIn('—Si ganas tú, —repuso su enemiga— tienes el derecho de pasar la noche aquí, hasta que sea de día.', 'repuso')).toBe('replied');
    expect(await hintIn('Pero aunque habían vencido al tigre, las rayas no estaban trauquilas porque tenían miedo de que viniera la tigra, y otros tigres, y otros muchos más.', 'tigra')).toBe('tigress');
    expect(await hintIn('Se puso a buscar en seguida raíces ricas y yuyitos tiernos, que le llevó al hombre para que comiera.', 'seguida')).toBe('at once');
    expect(await hintIn('Se puso a buscar en seguida raíces ricas y yuyitos tiernos, que le llevó al hombre para que comiera.', 'puso')).toBe('to start, become, put on');
    expect(await hintIn('En efecto: los tigres, que ya habían descansado, se pusieron bruscamente en pie, y agachándose como quien va a saltar, rugieron:', 'pie')).toBe("standing, on one's feet");
  });
});

// The native re-audit's sentences, from the three books above and the Lazarillo and El sombrero de tres picos.
describe('words the determiner or the word after decides', () => {
  it('read la, las, los after a pronoun that is no subject as the article before a noun', async () => {
    expect(await hintIn('"Necio, aprende que el mozo del ciego un punto ha de saber más que el diablo", y rió mucho la burla.', 'burla')).toBe('mockery');
    expect(await keyIn('En la concavidad panzuda distinguíanse grandes piedras, como restos de carga maltratados por las olas; y era tal la fuerza pictórica del claro-oscuro de la luna, que Golfín creyó ver, entre mil despojos de cosas náuticas, cadáveres medio devorados por los peces.', 'fuerza')).toBe('fuerza');
    expect(await keyIn('La idea de ver no se determina en mi pensamiento si antes no acaricio en él la idea de quererte más.', 'idea', 1)).toBe('idea');
    // A singular noun cannot follow los: "may it delight them".
    const s = 'pues podría ser que alguno que las lea halle algo que le agrade, y a los que no ahondaren tanto los deleite; y a este propósito dice Plinio que no hay libro, por malo que sea, que no tenga alguna cosa buena.';
    expect(await keyIn(s, 'los', 1)).toBe('los');
    expect(await keyIn(s, 'deleite')).toBe('deleitar');
  });

  it('read la señá as señora, and a title as the noun', async () => {
    const s = 'Empiezo por responderos de que la señá Frasquita, legítima esposa del tío Lucas, era una mujer de bien, y de que así lo sabían todos los ilustres visitantes del molino.';
    expect(await hintIn(s, 'señá')).toBe('Mrs.');
    expect(await hintIn(s, 'la')).toBe('the');
    expect(await hintIn('—Escúcheme V., señá Frasquita (le dijo Garduña, llamándola aparte).', 'señá')).toBe('Mrs.');
    expect(await hintIn('—Aquí están—dijo—el señor ingeniero y su hermano, el caballero de anoche.', 'señor')).toBe('sir, gentleman');
    const p = 'Estaba la señorita de pueblo muy gozosa en medio de las risueñas praderas sin la enojosa traba de las pragmáticas sociales de su señor padre, y así, en cuanto se vio a regular distancia de la casa, empezó a correr alegremente.';
    expect(await hintIn(p, 'padre')).toBe('father');
  });

  it('read mal as "bad" before a noun, "evil" after a determiner, "badly" anywhere else', async () => {
    expect(await hintIn('Contaba el mal ciego a todos cuantos allí se allegaban mis desastres, y dábales cuenta una y otra vez, así de la del jarro como de la del racimo, y agora de lo presente.', 'mal')).toBe('bad');
    expect(await hintIn('—No tengo ni quiero tener relación con ustedes respondió el Surubí, de mal humor.', 'mal')).toBe('bad');
    expect(await hintIn('—¿Qué mal es este?', 'mal')).toBe('evil');
    expect(await hintIn('Los vendimiadores lo miraban de reojo, en un mal disimulado desprecio; las mujeres, más por los hombres que por ellas, lo evitaban.', 'mal')).toBe('badly');
  });

  it('let the determiner\'s gender choose among the sections of one word', async () => {
    expect(await hintIn('Vió también un pájaro muy grande que cantaba, y entonces el coaticito se golpeó la frente y dijo:', 'frente')).toBe('forehead');
    expect(await hintIn('—¡Lindo día!... ¡rica, papa!...', 'papa')).toBe('potato');
    expect(await hintIn('¡Eres una real moza!', 'moza')).toBe('girl, young woman');
    expect(await keyIn('¡Eres una real moza!', 'real')).toBe('real');
  });

  it('read a participle after a determiner or an adjective as the noun spelled alike', async () => {
    expect(await hintIn('mas de que vi que con su venida mejoraba el comer, fuile queriendo bien, porque siempre traía pan, pedazos de carne, y en el invierno leños, a que nos calentábamos.', 'venida')).toBe('arrival');
    expect(await keyIn('sin más cultivo que una simple mirada de vez en cuando.', 'mirada')).toBe('mirada');
    expect(await keyIn('¡Maldita vista suya!', 'vista')).toBe('vista');
    // Not with its object after it.
    expect(await keyIn('Después de haber apagado la lámpara y cruzado las dobles cortinas de seda, se durmió.', 'cruzado')).toBe('cruzar');
  });

  it('read the noun and its adjective after a determiner, by which reading of the pair is likelier', async () => {
    expect(await hintIn('Estábamos jugando con Platero y con el loro, en el huerto de mi amigo, el médico francés, cuando una mujer joven, desordenada y ansiosa, llegó, cuesta abajo, hasta nosotros.', 'médico')).toBe('doctor');
    expect(await hintIn('se quedaron embobados de admiración, y sin más averiguaciones escribieron en su cartera de apuntes estas observaciones, que con el título de Sketches from Cantabria publicó más tarde un periódico inglés.', 'periódico')).toBe('newspaper');
    expect(await hintIn('Siguió a estas palabras un largo silencio, sólo interrumpido por el cariñoso mugido de las vacas en el cercano establo.', 'largo')).toBe('long');
    expect(await hintIn('asistió al asalto de Castillo Piñón, y permaneció luego largo tiempo en las provincias del Norte', 'largo')).toBe('long');
    expect(await hintIn('"¡O mala cosa, peor que tienes la hechura!', 'mala')).toBe('bad');
  });

  it('read a possessive after an article as the pronoun', async () => {
    expect(await hintIn('Va a tu alma, que ya pace en el Paraíso, por el alma de aquellos paisajes moguereños, qué también habrá subido al cielo con la tuya.', 'tuya')).toBe('yours');
  });
});

describe('verbs the words around them decide', () => {
  it('read ven and ve heading their clause as come! and go!', async () => {
    expect(await keyIn('—Choto, Choto, ven aquí.', 'ven')).toBe('venir');
    expect(await keyIn('Mira, Nela, ve y acompáñale.', 've')).toBe('ir');
    expect(await keyIn('¿No ve usted las tareas que se da?', 've')).toBe('ver');
  });

  it('read hace before a span of time as "ago"', async () => {
    expect(await hintIn('—Dicen que hace tres años.', 'hace')).toBe('ago');
    expect(await hintIn('Pero dime otra cosa. ¿Hace mucho tiempo que vives en las minas?', 'Hace')).toBe('ago');
    expect(await keyIn('—Vamos, vamos; aquí hace frío.', 'hace')).toBe('hacer');
    expect(await keyIn('Hacía mucho frío, además, y adentro reinaba la oscuridad más completa', 'Hacía')).toBe('hacer');
  });

  it('read no imperative after an object pronoun: le di is dar', async () => {
    expect(await keyIn('Las tomé, agradecido, y le di una al borriquillo débil; como dulce consuelo; otra a Platero, como premio áureo.', 'di')).toBe('dar');
    expect(await keyIn('Y dejéle en poder de mucha gente que lo había ido a socorrer, y tomé la puerta de la villa en los pies de un trote, y antes que la noche viniese di conmigo en Torrijos.', 'di')).toBe('dar');
  });

  it('read a participle after haber, and one heading its clause before its auxiliary', async () => {
    expect(await keyIn('—Por allí se ha escapado.', 'escapado')).toBe('escapar');
    expect(await keyIn('Criado te he y con buen amo te he puesto.', 'Criado')).toBe('criar');
    expect(await keyIn('Procura ser bueno, y Dios te guíe.', 'Procura')).toBe('procurar');
  });

  it('read an unaccented -o before an enclitic as the preterite, and keep ñ', async () => {
    expect(await hintIn('Primero estuvo hablando conmigo; preguntome varias cosas y me contó otras muy chuscas y divertidas.', 'preguntome')).toBe('to ask');
    expect(await keyIn('—A ver, enséñame tu cara.', 'enséñame')).toBe('enseñar');
  });
});

describe('adjectives where a noun was likelier', () => {
  it('read the predicate of caer and estar cada vez más as the adjective', async () => {
    expect(await hintIn('—Voy a morir, estoy cada vez más enfermo, y sólo en Buenos Aires me podría curar.', 'enfermo')).toBe('sick');
    expect(await hintIn('Mi padre cayó enfermo, y como mi madre no le quiso asistir, porque era malo, él fue al hospital donde dicen que se murió.', 'enfermo')).toBe('sick');
  });

  it('read a word joined by y to an adjective as one', async () => {
    expect(await hintIn('Platero va chorreando sangre, una sangre espesa y morada, de las picaduras, de los tábanos.', 'morada')).toBe('purple');
    expect(await keyIn('Una cosa enorme y tibia avanza, de pronto, como una proa viva, sobre mi hombro...', 'tibia')).toBe('tibio');
  });

  it('read bajo as the preposition only before a noun phrase', async () => {
    const s = 'llevaba el escote redondo y bajo, al estilo de Madrid, donde se detuvo dos meses con su Lucas al trasladarse de Navarra a Andalucía.';
    expect(await keyIn(s, 'bajo')).toBe('bajo');
    expect(lookupIn(await loadLang('es'), s, 'bajo').entries[0].senses[0].pos).toBe('adjective');
    expect(await hintIn('gritó a los yacarés que estaban bajo el agua sujetando el torpedo:', 'bajo')).toBe('under');
  });

  it('read an adverb spelled like a plural noun as the noun after a determiner', async () => {
    expect(await hintIn('De pronto, Platero, yergue las orejas, dilata las levantadas narices, replegándolas hasta los ojos y dejando ver las grandes habichuelas de sus dientes amarillos.', 'narices')).toBe('nose');
    expect(await keyIn('Este llevó a sus ojos la mano basta y ruda, endurecida por el arado, y se limpió una lágrima:', 'basta')).toBe('basto');
    expect(await hintIn('Basta ya de generalidades y de circunloquios, y entremos resueltamente en la historia del Sombrero de tres picos.', 'Basta')).toBe('enough!');
  });

  it('read an adverb that is also an interjection as the adverb where nothing exclaims it', async () => {
    expect(await hintIn('Arriba, por las ramas últimas, salta y pía un leve pajarillo, que el sol hace, cual toda la verde cima suspirante, de oro.', 'Arriba')).toBe('above');
  });
});

describe('words of one sense in these books', () => {
  it('read consigo after a verb and agora as "now"', async () => {
    expect(await hintIn('Salieron todos, juntamente con la Nela, a quien Teodoro quiso llevar consigo, y también salió D. Francisco.', 'consigo')).toBe('with himself');
    expect(await hintIn('sintió el desesperado ciego que agora tenía tiempo de tomar de mí venganza', 'agora')).toBe('now');
  });

  it('give hints that fit the books', async () => {
    expect(await hintIn('En el río Yabebirí, que está en Misiones, hay muchísimas rayas, porque "Yabebirí" quiere decir precisamente "Río - de - las - rayas".', 'rayas')).toBe('line; stingray');
    expect(await hintIn('Y cuando él andaba por la costa fumando, las rayas lo seguían arrastrándose por el barro, muy contentas de acompañar a su amigo.', 'barro')).toBe('mud, clay');
    expect(await hintIn('Es preciso que tú adquieras un don precioso de que yo estoy privado; es preciso que aprendas a leer.', 'preciso')).toBe('necessary; precise');
    expect(await hintIn('"Tio, una llave de este arca he perdido, y temo mi señor me azote.', 'arca')).toBe('chest, ark');
    expect(await hintIn('Había una vez una venado, —una gama— que tuvo dos hijos melizos, cosa rara entre los venados.', 'gama')).toBe('doe; range');
    expect(await hintIn('El discreto Golfín se sentó tranquilamente como podría haberlo hecho en el banco de un paseo.', 'discreto')).toBe('discreet, sensible');
    expect(await hintIn('—Pedrito, lorito!', 'lorito')).toBe('little parrot');
    expect(await hintIn('—Choto, Choto, ven aquí, no espantes a los pobres pajaritos.', 'pajaritos')).toBe('little bird');
    expect(await hintIn('No digo más sino que toda la laceria del mundo estaba encerrada en éste.', 'laceria')).toBe('misery, want');
    expect(await hintIn('algún tocino colgado al humero, algún queso puesto en alguna tabla', 'humero')).toBe('chimney flue');
    expect(await hintIn('un vendimiador le dio un racimo dellas en limosna', 'dellas')).toBe('of them');
  });

  it('give fixed phrases their whole hint, and literal words theirs', async () => {
    expect(await hintIn('si existía un estado más o menos allende el Pirineo', 'menos')).toBe('more or less');
    expect(await hintIn('y sin saber darme consejo, viéndome ir de mal en peor, un día que el cuitado ruin y lacerado de mi amo había ido fuera del lugar', 'peor')).toBe('from bad to worse');
    expect(await hintIn('Platero, de vez en cuando, deja de beber y levanta, como yo, la cabeza a las estrellas, con una blanda nostalgia infinita...', 'vez')).toBe('from time to time');
  });
});
