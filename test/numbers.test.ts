import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, readNumber } from '../src/normalize/numbers.ts';
import type { Block } from '../src/types.ts';

const block = (text: string, id = 'b1', kind: Block['kind'] = 'paragraph'): Block => ({ id, kind, text });
const pairs = (facts: ReturnType<typeof extractFacts>) => facts.map((f) => [f.value, f.unit]);

test('currency before the number, with a rate after it', () => {
  const [f] = extractFacts([block('The current rate is $0.042 per million input tokens.')], 'en');
  assert.equal(f?.value, 0.042);
  assert.equal(f?.unit, 'USD_per_million');
  assert.equal(f?.from, 'b1');
  assert.match(f?.context ?? '', /current rate is \$0\.042/);
  assert.doesNotMatch(f?.label ?? '', /\d/);
});

test('thousands separators and unit words', () => {
  const facts = extractFacts([block('Stay under 32,000 tokens, and 250,000 tokens per second.')], 'en');
  assert.deepEqual(pairs(facts), [
    [32_000, 'token'],
    [250_000, 'token_per_s'],
  ]);
});

test('percent, scale words and Russian units', () => {
  const facts = extractFacts([block('Accuracy fell by 12% after 3 млн запросов за 40 мс.')], 'ru');
  assert.deepEqual(pairs(facts), [
    [12, '%'],
    [3_000_000, 'request'],
    [40, 'ms'],
  ]);
});

// B3 — the decimal comma. "0,114 секунды" is a tenth of a second, not 114.
test('Russian decimal comma is a fraction, not thousands', () => {
  const facts = extractFacts([block('Заявленные цифры: 0,114 секунды против 8,566 у LLM и $0,000081 за прогон.')], 'ru');
  assert.deepEqual(pairs(facts), [
    [0.114, 's'],
    [0.000081, 'USD'],
  ]);
});

test('readNumber follows the locale and abstains when it cannot tell', () => {
  assert.equal(readNumber('0,114', 'ru'), 0.114);
  assert.equal(readNumber('1 200', 'ru'), 1200);
  assert.equal(readNumber('1.200', 'ru'), 1200);
  assert.equal(readNumber('1,200', 'en'), 1200);
  assert.equal(readNumber('0.114', 'en'), 0.114);
  assert.equal(readNumber('1,234,567', 'en'), 1_234_567);
  assert.equal(readNumber('1,234.5', 'en'), 1234.5);
  assert.equal(readNumber('0,114', 'unknown'), 0.114, 'a leading zero settles it');
  assert.equal(readNumber('1,200', 'unknown'), undefined, 'ambiguous without a language');
});

// B5 — decades and plurals.
test('"70s" and "1930s" are not seconds', () => {
  const facts = extractFacts([block('The couple, who are in their 70s, met in the 1930s and waited 5 s.')], 'en');
  assert.deepEqual(pairs(facts), [[5, 's']]);
});

// B9 — ranges keep both ends.
test('a range yields its lower and upper bound', () => {
  const facts = extractFacts([block('Сквозная задержка 3–329 секунд против 70–500 мс.')], 'ru');
  assert.deepEqual(pairs(facts), [
    [3, 's'],
    [329, 's'],
    [70, 'ms'],
    [500, 'ms'],
  ]);
  assert.ok(facts[0]?.label.endsWith('_min') && facts[1]?.label.endsWith('_max'));
});

// B10 — word multipliers and rates in Russian.
test('"за миллиард" is a rate and "188 тысяч" a multiplier', () => {
  const facts = extractFacts([block('Прайс $42 за миллиард входных токенов. Инструкция собрала 188 тысяч просмотров.')], 'ru');
  assert.deepEqual(pairs(facts), [
    [42, 'USD_per_billion'],
    [188_000, 'view'],
  ]);
});

// B12 — the rate lives in the column header, carried into the cell text.
test('a table cell takes its rate from the header', () => {
  const table: Block = { id: 'b1', kind: 'table', text: 'Model | Price per Btok | Rate limits\nModel: jev-1.13.0 | Price per Btok: $42 | Rate limits: 250,000 tokens per second' };
  const facts = extractFacts([table], 'en');
  assert.deepEqual(pairs(facts), [
    [42, 'USD_per_billion'],
    [250_000, 'token_per_s'],
  ]);
});

test('a bare number is not a fact, and years never are', () => {
  const facts = extractFacts([block('Founded in 2019, the team grew to 14 and shipped version 3.')], 'en');
  assert.deepEqual(facts, []);
});

test('code blocks are skipped and duplicates collapse', () => {
  const code: Block = { id: 'b2', kind: 'code', text: 'timeout = 5000 ms' };
  const facts = extractFacts([block('Costs $5 today. Costs $5 today.'), code], 'en');
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.from, 'b1');
});

test('facts are traceable to their block', () => {
  const facts = extractFacts([block('Plan A: 10 GB.', 'b7'), block('Plan B: 50 ГБ.', 'b9')], 'ru');
  assert.deepEqual(facts.map((f) => [f.from, f.unit]), [
    ['b7', 'GB'],
    ['b9', 'GB'],
  ]);
});

// Seen with Jev as the judge: a table row gave labels like "jev_jev_jev", the
// two rates in a row header were dropped, and a citation's "256 с." (pages)
// became seconds.
test('a table row header names the fact and rates pair up by position', () => {
  const facts = extractFacts(
    [block('Jev 1.13 | jev-1.13.0\nJev 1.13: Price (per Btok / per Mtok) | jev-1.13.0: $42 / $0.042', 'b3', 'table')],
    'en',
  );
  assert.deepEqual(
    facts.map((f) => [f.label, f.value, f.unit]),
    [['price_btok_mtok', 42, 'USD_per_billion'], ['price_btok_mtok', 0.042, 'USD_per_million']],
  );
});

test('Cyrillic "с." after a number is a page count, not seconds', () => {
  assert.equal(extractFacts([block('Иванов И. Парсинг. — М., 2001. — 256 с.')], 'ru').length, 0);
  assert.equal(extractFacts([block('Ответ пришёл за 256 с при нагрузке.')], 'ru')[0]?.unit, 's');
});

// Lab 4: Hebrew and Arabic press write numbers the English way and name
// currencies and scales in words after the number.
test('Hebrew and Arabic currencies, scales and units become facts', () => {
  const he = extractFacts([block('העסקה נסגרה ב-3,000 ש"ח ובסך הכל 2 מיליון דולר; הנסיעה נמשכה 45 דקות לאורך 120 ק"מ.')], 'he');
  assert.deepEqual(he.map((f) => [f.value, f.unit]), [[3000, 'ILS'], [2e6, 'USD'], [45, 'min'], [120, 'km']]);
  const ar = extractFacts([block('بلغت قيمة الصفقة 500 مليون دولار، وارتفعت الأسعار 12 بالمئة خلال 3 أيام.')], 'ar');
  assert.deepEqual(ar.map((f) => [f.value, f.unit]), [[5e8, 'USD'], [12, '%'], [3, 'day']]);
});

// Lab 4 follow-ups: Eastern Arabic digits, and "ago" timestamps in bylines.
test('Eastern Arabic digits are read, and "ago" durations are not facts', () => {
  const ar = extractFacts([block('بلغت التكلفة ٢٥٠ مليون دولار. نُشر قبل 3 ساعات.')], 'ar');
  assert.deepEqual(ar.map((f) => [f.value, f.unit]), [[2.5e8, 'USD']]);
  const en = extractFacts([block('Posted 2 hours ago. The build took 45 minutes.')], 'en');
  assert.deepEqual(en.map((f) => [f.value, f.unit]), [[45, 'min']]);
  const he = extractFacts([block('לפני 5 דקות. הנסיעה ארכה 40 דקות.')], 'he');
  assert.deepEqual(he.map((f) => [f.value, f.unit]), [[40, 'min']]);
});

// Lab 8 (recipes): quantities are the facts a cooking agent needs, and
// none of them had a unit the scanner knew.
test('kitchen units, oven temperatures and servings become facts', () => {
  const en = extractFacts([block('Cream 250 g butter with 1 cup sugar and 2 tbsp vanilla; bake at 350 degrees F (175 degrees C) for 12 minutes. Serves 4 people. Preheat to 190C/170C fan. Yield: 24 cookies, 19g carbs.')], 'en');
  assert.deepEqual(en.map((f) => [f.value, f.unit]), [[250, 'g'], [1, 'cup'], [2, 'tbsp'], [350, '°F'], [175, '°C'], [12, 'min'], [190, '°C'], [170, '°C'], [19, 'g']]);
  const ru = extractFacts([block('Возьмите 500 г творога, 200 мл молока и 2 ст. л. муки; выпекать при 180 градусах 25 минут. 6 порций.')], 'ru');
  assert.deepEqual(ru.map((f) => [f.value, f.unit]), [[500, 'g'], [200, 'ml'], [2, 'tbsp'], [180, '°C'], [25, 'min'], [6, 'serving']]);
  const de = extractFacts([block('400 g Mehl, 2 EL Öl, bei 180 °C 40 Min. backen. 4 Portionen.')], 'de');
  assert.deepEqual(de.map((f) => [f.value, f.unit]), [[400, 'g'], [2, 'tbsp'], [180, '°C'], [40, 'min'], [4, 'serving']]);
  // A weight in pounds is not sterling.
  assert.deepEqual(extractFacts([block('It weighs 300 pounds and costs £300.')], 'en').map((f) => [f.value, f.unit]), [[300, 'lb'], [300, 'GBP']]);
});

// Lab 9 (number locales): decimal commas were read right in de/fr, but the
// scale and currency words of ten languages were unknown, so GDP articles
// yielded almost no facts.
test('scale and currency words across languages', () => {
  const cases: [string, string, [number, string][]][] = [
    ['de', 'Das BIP betrug 4.185,55 Mrd. US-Dollar, ein Plus von 1,2 %.', [[4185.55e9, 'USD'], [1.2, '%']]],
    ['fr', 'Le PIB atteint 2 800 milliards de dollars et 1,5 million d\'euros.', [[2.8e12, 'USD'], [1.5e6, 'EUR']]],
    ['es', 'El PIB fue de 1.400 mil millones de dólares.', [[1.4e12, 'USD']]],
    ['it', 'Il PIL è di 2.100 miliardi di dollari.', [[2.1e12, 'USD']]],
    ['pl', 'PKB wyniósł 800 mld dolarów oraz 3 mln złotych.', [[8e11, 'USD'], [3e6, 'PLN']]],
    ['tr', 'GSYH 1,1 trilyon dolar ve 500 milyar TL.', [[1.1e12, 'USD'], [5e11, 'TRY']]],
    ['pt', 'O PIB foi de 2,1 trilhões de dólares e 500 bilhões de reais.', [[2.1e12, 'USD'], [5e11, 'BRL']]],
    ['ja', 'GDPは26,185億ドル、対前年比2.5%増。', [[26185e8, 'USD'], [2.5, '%']]],
    ['zh', '国内生产总值为18万亿美元。', [[18e12, 'USD']]],
    // Korean compounds ('1조 8000억') are read as their last group; the first is a known gap.
    ['ko', 'GDP는 8000억 달러였다.', [[8000e8, 'USD']]],
  ];
  for (const [lang, text, expected] of cases) {
    const got = extractFacts([block(text)], lang).map((f) => [f.value, f.unit]);
    assert.deepEqual(got, expected, `${lang}: ${JSON.stringify(got)}`);
  }
});
