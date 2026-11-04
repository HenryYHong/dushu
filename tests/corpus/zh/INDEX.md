# Held-out Chinese corpus

Texts Dushu was never tuned on, for measuring how it reads books it has not seen (`scripts/eval/zh-dump.mjs`,
`tests/corpus/zh-corpus.test.ts`). None of the tuning texts (the public-domain samples in `public/samples` and the owner's own
books) or other parts of the same works are here. One work, article or anthology per `.txt` file; the file name is the id. Line 1
is the title, chapter headings are lines of their own. Fetched 2026-11-03, original script kept (Wikisource and Wikinews pages are
mostly traditional; Wikipedia was fetched in the zh-cn variant except the two zh-tw articles).

The files sit in one folder per license (see `LICENSES.md`): `public-domain/`, `cc-by-sa/` (Wikipedia) and `cc-by/` (Wikinews,
Global Storybooks, Tatoeba). `texts.tsv` lists each id with its folder and genre for the tools.

"chars" counts every code point in the file, "han" Han characters only.

| id | title | author | year | source | license | chars | han | genre |
|---|---|---|---|---|---|---:|---:|---|
| luxun-zhufu | 祝福 | 魯迅 | 1924 (東方雜誌; in 彷徨 1926) | https://zh.wikisource.org/wiki/%E7%A5%9D%E7%A6%8F | US public domain (first published before 1931); author d. 1936 | 9295 | 7845 | 1920s-fiction |
| luxun-shangshi | 傷逝 | 魯迅 | 1925 (written; first printed in 彷徨 1926) | https://zh.wikisource.org/wiki/%E5%82%B7%E9%80%9D_(%E9%AD%AF%E8%BF%85) | US public domain (first published before 1931); author d. 1936 | 11111 | 9434 | 1920s-fiction |
| luxun-a-q-zhengzhuan | 阿Q正傳 | 魯迅 | 1921–22 (晨報副刊) | https://zh.wikisource.org/wiki/%E9%98%BFQ%E6%AD%A3%E5%82%B3 | US public domain (first published before 1931); author d. 1936 | 21735 | 17958 | 1920s-fiction |
| yudafu-chenlun | 沉淪 | 郁達夫 | 1921 (沉淪, 泰東書局) | https://zh.wikisource.org/wiki/%E6%B2%89%E6%B7%AA_(%E9%83%81%E9%81%94%E5%A4%AB) | US public domain (first published before 1931); author d. 1945 | 20776 | 16675 | 1920s-fiction |
| luyin-haibin-guren | 海濱故人 | 廬隱 | 1923 (小說月報 14:10, 14:12) | https://zh.wikisource.org/wiki/%E6%B5%B7%E6%BF%B1%E6%95%85%E4%BA%BA | US public domain (first published before 1931); author d. 1934 | 34603 | 29116 | 1920s-fiction |
| xudishan-mingmingniao | 命命鳥 | 許地山 | 1921 (小說月報; in 綴網勞蛛 1925) | https://zh.wikisource.org/wiki/%E5%91%BD%E5%91%BD%E9%B3%A5 | US public domain (first published before 1931); author d. 1941 | 10830 | 9183 | 1920s-fiction |
| laoshe-laozhang-de-zhexue | 老張的哲學 (sections 一–二十四, about half the novel) | 老舍 | 1926 (小說月報; book 1928) | https://zh.wikisource.org/wiki/%E8%80%81%E5%BC%B5%E7%9A%84%E5%93%B2%E5%AD%B8 | US public domain (first published before 1931); author d. 1966 | 54239 | 44507 | 1920s-fiction |
| luxun-yecao | 野草 (題辭 + all 23 pieces; the 1931 English-edition preface left out) | 魯迅 | 1924–26 pieces, book 1927 | https://zh.wikisource.org/wiki/%E9%87%8E%E8%8D%89 | US public domain (first published before 1931); author d. 1936 | 20020 | 16425 | 1920s-prose |
| xuzhimo-sanwen | 徐志摩散文六篇: 我的祖母之死, 北戴河海濱的幻想, 翡冷翠山居閒話, 我所知道的康橋, 自剖, 想飛 | 徐志摩 | 1923–26 | https://zh.wikisource.org/wiki/Author%3A%E5%BE%90%E5%BF%97%E6%91%A9 | US public domain (first published before 1931); author d. 1931 | 25662 | 21905 | 1920s-prose |
| hushi-wencun | 胡適文存選: 文學改良芻議, 建設的文學革命論, 易卜生主義, 新思潮的意義, 李超傳 | 胡適 | 1917–19 (新青年 etc.; 胡適文存 1921) | https://zh.wikisource.org/wiki/%E6%96%87%E5%AD%B8%E6%94%B9%E8%89%AF%E8%8A%BB%E8%AD%B0 | US public domain (first published before 1931); author d. 1962 (still protected in life+70 countries until 2033) | 38414 | 31750 | 1920s-prose |
| rulin-waishi | 儒林外史 第二–三回 | 吳敬梓 | c. 1750 (printed 1803) | https://zh.wikisource.org/wiki/%E5%84%92%E6%9E%97%E5%A4%96%E5%8F%B2/%E7%AC%AC02%E5%9B%9E | public domain (pre-1900; author died centuries ago) | 14111 | 11782 | qing-novel |
| laocan-youji | 老殘遊記 第一–二回 | 劉鶚 | 1903–07 | https://zh.wikisource.org/wiki/%E8%80%81%E6%AE%98%E9%81%8A%E8%A8%98/%E7%AC%AC01%E5%9B%9E | public domain (pre-1931; author d. 1909) | 9582 | 8119 | qing-novel |
| jinghuayuan | 鏡花緣 第十一–十二回 | 李汝珍 | 1818–28 | https://zh.wikisource.org/wiki/%E9%8F%A1%E8%8A%B1%E7%B7%A3/%E7%AC%AC011%E5%9B%9E | public domain (pre-1900; author died centuries ago) | 8949 | 7433 | qing-novel |
| guanchang-xianxingji | 官場現形記 第一–二回 (editor glosses 〈（…）〉 removed) | 李寶嘉 | 1903–05 | https://zh.wikisource.org/wiki/%E5%AE%98%E5%A0%B4%E7%8F%BE%E5%BD%A2%E8%A8%98/01 | public domain (pre-1931; author d. 1906) | 16132 | 13749 | qing-novel |
| ernv-yingxiongzhuan | 兒女英雄傳 第四–五回 | 文康 | 1878 | https://zh.wikisource.org/wiki/%E5%85%92%E5%A5%B3%E8%8B%B1%E9%9B%84%E5%82%B3/%E7%AC%AC%E5%9B%9B%E5%9B%9E | public domain (pre-1900; author died centuries ago) | 19906 | 16870 | qing-novel |
| liaozhai-zhiyi | 聊齋誌異 卷一, ten tales: 考城隍 瞳人語 畫壁 王六郎 偷桃 種梨 勞山道士 嬌娜 青鳳 畫皮 (commentary lines removed) | 蒲松齡 | c. 1679 (printed 1766) | https://zh.wikisource.org/wiki/%E8%81%8A%E9%BD%8B%E5%BF%97%E7%95%B0/%E7%AC%AC01%E5%8D%B7 | public domain (pre-1900; author died centuries ago) | 14072 | 10927 | classical |
| wiki-changcheng | 长城 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94640681&variant=zh-cn | CC BY-SA 4.0 | 10680 | 8695 | wiki |
| wiki-daxiongmao | 大熊猫 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94858448&variant=zh-cn | CC BY-SA 4.0 | 10244 | 8219 | wiki |
| wiki-gaokao | 普通高等学校招生全国统一考试 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94130626&variant=zh-cn | CC BY-SA 4.0 | 13436 | 10845 | wiki |
| wiki-gaotie | 中华人民共和国高速铁路 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94552140&variant=zh-cn | CC BY-SA 4.0 | 19971 | 16053 | wiki |
| wiki-hangzhou | 杭州市 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95394507&variant=zh-cn | CC BY-SA 4.0 | 19878 | 16093 | wiki |
| wiki-jiaozi | 饺子 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94701986&variant=zh-cn | CC BY-SA 4.0 | 4119 | 3335 | wiki |
| wiki-jingju | 京剧 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94152948&variant=zh-cn | CC BY-SA 4.0 | 9564 | 7597 | wiki |
| wiki-luotuo-xiangzi | 骆驼祥子 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=93216148&variant=zh-cn | CC BY-SA 4.0 | 5442 | 4695 | wiki |
| wiki-pingpangqiu | 乒乓球 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=92987740&variant=zh-cn | CC BY-SA 4.0 | 4325 | 3420 | wiki |
| wiki-taibei | 臺北市 (lead + sections up to ~20k chars; zh-tw) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95367331&variant=zh-tw | CC BY-SA 4.0 | 19922 | 16490 | wiki |
| wiki-taifeng | 熱帶氣旋 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94083722&variant=zh-cn | CC BY-SA 4.0 | 12894 | 10854 | wiki |
| wiki-tu-youyou | 屠呦呦 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95321657&variant=zh-cn | CC BY-SA 4.0 | 3289 | 2673 | wiki |
| wiki-weixin | 微信 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95378662&variant=zh-cn | CC BY-SA 4.0 | 14972 | 12144 | wiki |
| wiki-yao-ming | 姚明 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95072027&variant=zh-cn | CC BY-SA 4.0 | 10119 | 7542 | wiki |
| wiki-zhenzhu-naicha | 珍珠奶茶 (lead + sections up to ~20k chars; zh-tw) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95384724&variant=zh-tw | CC BY-SA 4.0 | 3175 | 2550 | wiki |
| wiki-zhineng-shouji | 智能手机 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=95291946&variant=zh-cn | CC BY-SA 4.0 | 3232 | 2369 | wiki |
| wiki-zhongqiujie | 中秋节 (lead + sections up to ~20k chars; zh-cn) | Wikipedia contributors | revision of 2026 | https://zh.wikipedia.org/w/index.php?oldid=94733763&variant=zh-cn | CC BY-SA 4.0 | 5698 | 4702 | wiki |
| wiki-juqing-xuan | 影视与小说剧情选: plot sections of 流浪地球 你好，李焕英 我不是药神 让子弹飞 琅琊榜 许三观卖血记 少年的你 霸王别姬 狼图腾 千与千寻 (zh-cn) | Wikipedia contributors | revisions of 2025–26 | https://zh.wikipedia.org/w/index.php?oldid=93404524 (流浪地球 (电影)); https://zh.wikipedia.org/w/index.php?oldid=94020262 (你好，李焕英); https://zh.wikipedia.org/w/index.php?oldid=93647813 (我不是药神); https://zh.wikipedia.org/w/index.php?oldid=92361505 (让子弹飞); https://zh.wikipedia.org/w/index.php?oldid=93969181 (瑯琊榜 (電視劇)); https://zh.wikipedia.org/w/index.php?oldid=91613008 (許三觀賣血記); https://zh.wikipedia.org/w/index.php?oldid=95286184 (少年的你); https://zh.wikipedia.org/w/index.php?oldid=93047417 (霸王別姬 (電影)); https://zh.wikipedia.org/w/index.php?oldid=94449877 (狼圖騰); https://zh.wikipedia.org/w/index.php?oldid=94787677 (千与千寻) | CC BY-SA 4.0 | 11556 | 10389 | wiki |
| news-aozhou-aizheng-juji | 首谈近期“癌症聚集”担忧，澳中学举行特别集会 | Wikinews contributors | 2025-12-03 | https://zh.wikinews.org/w/index.php?oldid=272083 | CC BY 4.0 | 960 | 827 | news |
| news-aozhou-shemei-jinling | 澳大利亚全球首推“未成年人社媒禁令” | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286307 | CC BY 4.0 | 914 | 691 | news |
| news-aqimeisu-mali | 阿奇霉素未能下降马里婴儿死亡率 | Wikinews contributors | 2026-01-02 | https://zh.wikinews.org/w/index.php?oldid=272852 | CC BY 4.0 | 777 | 588 | news |
| news-dibai-hangzhan-zhuiji | 印度一光辉战机于迪拜航展飞行表演中坠毁，飞行员不幸遇难 | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286139 | CC BY 4.0 | 484 | 402 | news |
| news-gudaoer-shishi | 观察60年黑猩猩的动物学家珍·古道尔巡回中逝世 | Wikinews contributors | 2025-10-11 | https://zh.wikinews.org/w/index.php?oldid=270346 | CC BY 4.0 | 899 | 713 | news |
| news-liuyang-yanhua | 中國湖南瀏陽一煙花廠發生爆炸，致26死61傷 | Wikinews contributors | 2026-05-05 | https://zh.wikinews.org/w/index.php?oldid=284205 | CC BY 4.0 | 334 | 266 | news |
| news-moshushi-caifang | 幻术道具自己做？魔术师是什么？采访德州魔协主席 | Wikinews contributors | 2025-11-08 | https://zh.wikinews.org/w/index.php?oldid=271279 | CC BY 4.0 | 2045 | 1766 | news |
| news-nba-dubo | NBA再爆涉赌丑闻 比卢普斯与罗齐尔被捕 | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286026 | CC BY 4.0 | 1655 | 1252 | news |
| news-pubu-qiuqian | 景区瀑布秋千事故，坠亡女孩网传仅16岁 | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286998 | CC BY 4.0 | 526 | 449 | news |
| news-roblox-jinisi | 18岁比利时学生揭露Roblox作弊行为并获得吉尼斯世界纪录 | Wikinews contributors | 2026-05-04 | https://zh.wikinews.org/w/index.php?oldid=280804 | CC BY 4.0 | 896 | 732 | news |
| news-shijieyu-huang-yinbao | 柴诞节，访著名中国世界语者黄银宝 | Wikinews contributors | 2026-01-18 | https://zh.wikinews.org/w/index.php?oldid=273279 | CC BY 4.0 | 6275 | 5629 | news |
| news-taiwan-guoqing | 臺灣舉行中華民國114年國慶大會 | Wikinews contributors | 2026-01-11 | https://zh.wikinews.org/w/index.php?oldid=273059 | CC BY 4.0 | 2636 | 2178 | news |
| news-weiji-xinwen-guanbi | 維基媒體基金會關閉維基新聞 結束現網站21年歷史 | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286343 | CC BY 4.0 | 1482 | 1197 | news |
| news-wenhua-daibiao | 在墓地或无人的废墟里过夜……在国外当一名文化代表容易吗？ | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286172 | CC BY 4.0 | 833 | 682 | news |
| news-who-yaowu-qingdan | 世界卫生组织更新基本药物清单，首次添加减肥药 | Wikinews contributors | 2026-01-10 | https://zh.wikinews.org/w/index.php?oldid=273039 | CC BY 4.0 | 607 | 453 | news |
| news-xianggang-tianqi | 2025年9月24日香港天氣報告 | Wikinews contributors | 2026-05-06 | https://zh.wikinews.org/w/index.php?oldid=286004 | CC BY 4.0 | 930 | 727 | news |
| news-xidu-jilu-fengcun | “吸毒记录封存”条款及其引发的网络抗议 | Wikinews contributors | 2025-12-13 | https://zh.wikinews.org/w/index.php?oldid=272274 | CC BY 4.0 | 3325 | 2898 | news |
| news-zhang-xuefeng | 以高考志愿填报闻名的网络名人张雪峰去世 | Wikinews contributors | 2026-04-06 | https://zh.wikinews.org/w/index.php?oldid=275114 | CC BY 4.0 | 319 | 275 | news |
| global-storybooks-zh | 全球故事书: the 54 CC-BY Mandarin stories (CC BY-NC ones left out); per-story credits in global-storybooks-zh.credits.tsv | African Storybook authors; translators dohliam, Vicky Liu and others | 2014–2019 translations | https://github.com/global-asp/global-asp/tree/master/zh | CC BY 3.0/4.0 (per story) | 20667 | 17588 | contemporary-story |
| tatoeba-juzi-jianti | Tatoeba 中文例句（简体）: 1,800 sentences, seeded random sample (6–60 chars, Han + punctuation only); ids in .ids.tsv | Tatoeba contributors | export of 2026-10-31 | https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2 | CC BY 2.0 FR | 21829 | 17809 | everyday-sentences |
| tatoeba-juzi-fanti | Tatoeba 中文例句（繁體）: 700 sentences, same sample rules; ids in .ids.tsv | Tatoeba contributors | export of 2026-10-31 | https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2 | CC BY 2.0 FR | 9511 | 7910 | everyday-sentences |

## Totals by genre

| genre | files | chars | han |
|---|---:|---:|---:|
| 1920s-fiction | 7 | 162,589 | 134,718 |
| 1920s-prose | 3 | 84,096 | 70,080 |
| qing-novel | 5 | 68,680 | 57,953 |
| classical | 1 | 14,072 | 10,927 |
| wiki | 18 | 182,516 | 148,665 |
| news | 18 | 25,897 | 21,725 |
| contemporary-story | 1 | 20,667 | 17,588 |
| everyday-sentences | 2 | 31,340 | 25,719 |
| **total** | 55 | 589,857 | 487,375 |

## Notes

- Not on zh.wikisource (so not included): 冰心 超人 / 寄小讀者, 葉聖陶 稻草人 (the page has no text), 茅盾 幻滅, 巴金 滅亡, 張恨水 啼笑因緣.
- `everyday-sentences` stands in for colloquial modern usage: contemporary narrative under a free license is scarce (Global Storybooks
  has about 17k Han characters under CC BY).
- Editorial furniture removed: Wikisource headers, license boxes, page numbers, footnote lists, variant tooltips (一作「…」), 〈（…）〉
  glosses in 官場現形記, 〔何評〕/〔方評〕 commentary in 聊齋, zero-width spaces. Source quirks kept as found (a stray `[[` in
  news-liuyang-yanhua, inline English in 我的祖母之死, editors' date lines such as （一九二一年十二月。）).
- Wikipedia section headings are kept as plain lines; reference, see-also and external-link sections are cut. Wikinews "消息來源"
  sections are cut. These are changes to the CC BY-SA and CC BY originals, as the licenses ask us to say.
- 23 sentences (in 21 lines) of Wikipedia, Wikinews, Global Storybooks and Tatoeba text, each holding a set phrase of eight or more
  characters, were dropped so
  that `scripts/check-public.mjs` stays clean on the owner's machine; three Wikipedia lines that were one such sentence went with
  them, and two Tatoeba sentences (their ids too). The counts above are after the drop.
- Three native-speaker audits read about 78,500 Han characters of this corpus through the reader; what they found is in
  `silver.tsv` (see `../README.md`).
