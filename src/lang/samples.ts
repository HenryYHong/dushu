// A sentence of each language for the settings preview and the voice test: the opening of a public-domain book.
import type { LangId } from './types';

export const SAMPLE_SENTENCES: Record<LangId, string> = {
  zh: '你好，欢迎使用读书。今天我们一起读一本书。',
  // 夏目漱石『吾輩は猫である』(1905)
  ja: '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。',
  // Cervantes, Don Quijote (1605)
  es: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo.',
  // Perrault, Le Petit Chaperon rouge (1697)
  fr: 'Il était une fois une petite fille de village, la plus jolie qu’on eût su voir ; sa mère en était folle.',
  // Kafka, Die Verwandlung (1915)
  de: 'Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt.',
  // Collodi, Le avventure di Pinocchio (1883)
  it: 'C’era una volta un pezzo di legno. Non era un legno di lusso, ma un semplice pezzo da catasta.',
  // Machado de Assis, Dom Casmurro (1899)
  pt: 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro.',
  // Tolstoy, Anna Karenina (1878)
  ru: 'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.',
};
