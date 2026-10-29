"""The credit line for each classic's cover (public/samples/<lang>/covers/<id>.jpg), made with cover.py from the Commons file
named in the comment. build_index.py writes these into index.json. Every image is public domain: its artist died more than
a hundred years ago, it is a museum's public-domain release, or it was published before 1930 by an artist dead over 70 years."""
PD = 'Public domain, via Wikimedia Commons.'
COVERS = {
    # ---- Japanese
    ('ja', 'kumo-no-ito'): f'Kawanabe Kyōsai, Hell Courtesan (Jigoku-dayū), about 1874. {PD}',
    ('ja', 'toshishun'): f'Kanō Sansetsu, the Daoist immortals Li Tieguai and Han Xiangzi, from a set of screens, 17th century. Minneapolis Institute of Art. {PD}',
    ('ja', 'chumon'): f'Utagawa Kuniyoshi, cats in many poses, 1852. {PD}',
    ('ja', 'rashomon'): f'Utagawa Kuniyoshi, Watanabe no Tsuna Fighting the Demon at Rashōmon, 1840s. {PD}',
    ('ja', 'yume-juya'): f'Tsukioka Yoshitoshi, Chang’e Fleeing to the Moon, from One Hundred Aspects of the Moon, about 1885. {PD}',
    ('ja', 'botchan'): f'Utagawa Yoshitora, Steam Railroad in Tokyo, 1871. Honolulu Museum of Art. {PD}',
    ('ja', 'kokoro'): f'Kobayashi Kiyochika, The Sumida River at Night, 1881. Honolulu Museum of Art. {PD}',
    ('ja', 'wagahai'): f'Hishida Shunsō, Black Cat, 1910. Eisei Bunko Museum. {PD}',
    # ---- Spanish
    ('es', 'cuentos-de-la-selva'): f'Henri Rousseau, Surprised! (Tiger in a Tropical Storm), 1891. National Gallery, London. {PD}',
    ('es', 'platero-y-yo'): f'Modesto Teixidor, Women Riding a Donkey, about 1890. Museo Art Nouveau y Art Déco Casa Lis, Salamanca. {PD}',
    ('es', 'quiroga-cuentos'): f'Henri Rousseau, The Snake Charmer, 1907. Musée d’Orsay, Paris. {PD}',
    ('es', 'leyendas-becquer'): f'Valeriano Bécquer, Portrait of Gustavo Adolfo Bécquer, his brother, 1862. Museo de Bellas Artes de Sevilla. {PD}',
    ('es', 'sombrero-de-tres-picos'): f'Francisco de Goya, The Parasol (El quitasol), 1777. Museo del Prado, Madrid. {PD}',
    ('es', 'lazarillo-de-tormes'): f'Bartolomé Esteban Murillo, The Young Beggar, about 1645–50. Musée du Louvre, Paris. {PD}',
    ('es', 'marianela'): f'Francisco de Goya, The Blind Guitarist (El ciego de la guitarra), 1778. Museo del Prado, Madrid. {PD}',
    # ---- French
    ('fr', 'contes-de-perrault'): f'Gustave Doré, Little Red Riding Hood in bed with the wolf, for Les Contes de Perrault, 1862. {PD}',
    ('fr', 'la-parure'): f'Pierre-Auguste Renoir, La Loge (The Theater Box), 1874. The Courtauld, London. {PD}',
    ('fr', 'le-horla'): f'Odilon Redon, Eye-Balloon, 1878. Museum of Modern Art, New York. {PD}',
    ('fr', 'candide'): f'Jean-Honoré Fragonard, The Swing, 1767. The Wallace Collection, London. {PD}',
    ('fr', 'lettres-de-mon-moulin'): f'Vincent van Gogh, Harvest in Provence, 1888. Van Gogh Museum, Amsterdam. {PD}',
    ('fr', 'le-tour-du-monde'): f'J. M. W. Turner, Rain, Steam and Speed: The Great Western Railway, 1844. National Gallery, London. {PD}',
    ('fr', 'madame-bovary'): f'Albert-Auguste Fourié, The Death of Madame Bovary, 1883. Musée des Beaux-Arts de Rouen. {PD}',
    # ---- German
    ('de', 'max-und-moritz'): f'Wilhelm Busch, Max and Moritz, from Max und Moritz, 1865. {PD}',
    ('de', 'struwwelpeter'): f'Heinrich Hoffmann, Struwwelpeter, the title figure of Der Struwwelpeter, 1845. {PD}',
    ('de', 'immensee'): f'Caspar David Friedrich, Woman before the Setting Sun, about 1818. Museum Folkwang, Essen. {PD}',
    ('de', 'die-verwandlung'): f'Albrecht Dürer, Stag Beetle, 1505. J. Paul Getty Museum, Los Angeles. {PD}',
    ('de', 'siddhartha'): f'Liang Kai, Shakyamuni Emerging from the Mountains, 13th century. Tokyo National Museum. {PD}',
    ('de', 'werther'): f'Wilhelm Amberg, Reading Goethe’s Werther, 1870. {PD}',
    ('de', 'effi-briest'): f'Caspar David Friedrich, Woman at a Window, 1822. Alte Nationalgalerie, Berlin. {PD}',
    # ---- Italian
    ('it', 'pinocchio'): f'Enrico Mazzanti, Pinocchio, for the first edition of Le avventure di Pinocchio, 1883. {PD}',
    ('it', 'rosso-malpelo'): f'Antonio Mancini, The Street Boy (Lo scugnizzo), about 1880. {PD}',
    ('it', 'il-treno-ha-fischiato'): f'Umberto Boccioni, States of Mind: The Farewells, 1911. Museum of Modern Art, New York. {PD}',
    ('it', 'il-principe'): f'Santi di Tito, Portrait of Niccolò Machiavelli, 16th century. Palazzo Vecchio, Florence. {PD}',
    ('it', 'inferno'): f'Domenico di Michelino, Dante and the Three Kingdoms, 1465. Florence Cathedral. {PD}',
    ('it', 'il-fu-mattia-pascal'): f'Edvard Munch, At the Roulette Table in Monte Carlo, 1892. Munch Museum, Oslo. {PD}',
    ('it', 'i-promessi-sposi'): f'Francesco Hayez, The Kiss, 1859. Pinacoteca di Brera, Milan. {PD}',
    # ---- Portuguese
    ('pt', 'um-apologo'): f'Johannes Vermeer, The Lacemaker, about 1669–70. Musée du Louvre, Paris. {PD}',
    ('pt', 'missa-do-galo'): f'Almeida Júnior, Reading, 1892. Pinacoteca de São Paulo. {PD}',
    ('pt', 'a-cartomante'): f'Caravaggio, The Fortune Teller, about 1594. Capitoline Museums, Rome. {PD}',
    ('pt', 'o-alienista'): f'Tony Robert-Fleury, Pinel Freeing the Insane at the Salpêtrière, 1876. {PD}',
    ('pt', 'iracema'): f'Frans Post, View of Olinda, Brazil, 1662. Rijksmuseum, Amsterdam. {PD}',
    ('pt', 'dom-casmurro'): f'Belmiro de Almeida, The Quarrel (Arrufos), 1887. Museu Nacional de Belas Artes, Rio de Janeiro. {PD}',
    ('pt', 'memorias-postumas'): f'Almeida Júnior, Longing (Saudade), 1899. Pinacoteca de São Paulo. {PD}',
    ('pt', 'os-maias'): f'Columbano Bordalo Pinheiro, The Grey Glove, 1881. Museu Nacional de Arte Contemporânea, Lisbon. {PD}',
    # ---- Russian
    ('ru', 'tolstoy-rasskazy'): f'Ivan Shishkin and Konstantin Savitsky, Morning in a Pine Forest, 1889. Tretyakov Gallery, Moscow. {PD}',
    ('ru', 'kashtanka'): f'Dmitry Kardovsky, illustration for Chekhov’s Kashtanka, 1903. {PD}',
    ('ru', 'mumu'): f'Vasily Polenov, A Moscow Courtyard, 1878. Tretyakov Gallery, Moscow. {PD}',
    ('ru', 'shinel'): f'Pavel Fedotov, The Fresh Cavalier, 1846. Tretyakov Gallery, Moscow. {PD}',
    ('ru', 'belye-nochi'): f'Vasily Surikov, the Bronze Horseman at night, St. Petersburg, 1870. {PD}',
    ('ru', 'kapitanskaya-dochka'): f'Vasily Perov, Pugachev’s Court, 1875. State Historical Museum, Moscow. {PD}',
    ('ru', 'geroi-nashego-vremeni'): f'Mikhail Lermontov, A Skirmish in the Mountains of Dagestan, 1840. {PD}',
}
