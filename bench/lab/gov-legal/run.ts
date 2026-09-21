/**
 * Lab 5: government and legal pages. Fee schedules in tables, long statutes,
 * regulations, filings — the pages where a number with the wrong unit or a
 * chunk cut mid-section does real damage.
 *
 * For each page: what Sieve reads (currency facts, table rows, chunks,
 * block-split); then Jev answers one typed question per page from the state
 * (jev_extract) and verifies Sieve's own currency facts (jev_verify).
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/gov-legal/run.ts
 */

import { servers, call, page, save, csv, BAD, pad, num } from '../lib.ts';

const DIR = 'bench/lab/gov-legal';
const PAGES: { id: string; url: string; question: string; pattern: string }[] = [
  { id: 'gov.uk visa fees', url: 'https://www.gov.uk/government/publications/visa-regulations-revised-table/home-office-immigration-and-nationality-fees-9-april-2025', question: 'The fee for a Skilled Worker visa application (up to 3 years) made outside the UK.', pattern: '£\\s?\\d[\\d,]*(?:\\.\\d\\d)?' },
  { id: 'gov.uk passport', url: 'https://www.gov.uk/passport-fees', question: 'The fee for a standard adult passport applied for online.', pattern: '£\\s?\\d[\\d,]*(?:\\.\\d\\d)?' },
  { id: 'irs brackets', url: 'https://www.irs.gov/filing/federal-income-tax-rates-and-brackets', question: 'The top marginal federal income tax rate for tax year 2025.', pattern: '\\d{1,2}(?:\\.\\d)?\\s?%' },
  { id: 'uscis fees', url: 'https://www.uscis.gov/g-1055', question: 'The filing fee for Form N-400 (naturalization) filed on paper.', pattern: '\\$\\s?\\d[\\d,]*' },
  { id: 'canada fees', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/pay-fees.html', question: 'The right of permanent residence fee.', pattern: '\\$\\s?\\d[\\d,]*(?:\\.\\d\\d)?' },
  { id: 'eur-lex gdpr', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679', question: 'The maximum administrative fine under Article 83(5) as a percentage of worldwide annual turnover.', pattern: '\\d{1,2}\\s?%' },
  { id: 'legislation.gov.uk', url: 'https://www.legislation.gov.uk/ukpga/2018/12/section/1', question: 'The year the Data Protection Act was passed.', pattern: '\\b20\\d\\d\\b' },
  { id: 'gov.il fees', url: 'https://www.gov.il/he/service/passport_issuance', question: 'The fee in shekels for issuing a passport.', pattern: '\\d[\\d,]*\\s?(?:₪|ש"ח|שקל)' },
  { id: 'sec 10-k', url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm', question: 'Total net sales for the fiscal year ended September 28, 2024, in millions of dollars.', pattern: '\\$?\\s?\\d{1,3}(?:,\\d{3})+' },
  { id: 'federalregister', url: 'https://www.federalregister.gov/documents/2024/04/23/2024-08596/nondiscrimination-on-the-basis-of-disability-in-programs-or-activities-receiving-federal-financial-assistance', question: 'The effective date of the rule.', pattern: '[A-Z][a-z]+ \\d{1,2}, \\d{4}' },
  { id: 'companies house', url: 'https://www.gov.uk/government/publications/companies-house-fees/companies-house-fees', question: 'The fee to incorporate a company online.', pattern: '£\\s?\\d[\\d,]*(?:\\.\\d\\d)?' },
  { id: 'ato', url: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents', question: 'The tax-free threshold for Australian residents.', pattern: '\\$\\s?\\d[\\d,]*' },
];

const { sieve, jev, close } = await servers();

console.log('== sieve_page ==');
const rows: any[] = [];
const texts: Record<string, string> = {};
const facts: Record<string, any[]> = {};
for (const p of PAGES) {
  const r = await page(sieve, p.url, 'full');
  texts[p.id] = r.text;
  facts[p.id] = r.state?.facts ?? [];
  const money = facts[p.id]!.filter((f: any) => /^(USD|GBP|EUR|ILS|CAD|AUD)/.test(f.unit ?? ''));
  const tables = (r.text.match(/^[^\n]+ \| [^\n]+$/gm) ?? []).length;
  const row = { id: p.id, ...r.row, moneyFacts: money.length, tableRows: tables, split: String(r.row.warnings).includes('block-split') };
  rows.push(row);
  console.log(pad(p.id, 20), num(row.rawTokens, 8), '→', num(row.stateTokens, 6), 'chunks', num(row.chunks, 2), 'facts', num(row.facts, 3), 'money', num(row.moneyFacts, 3), 'rows', num(tables, 3), pad(row.warnings || '-', 22), pad(row.title, 40));
}

console.log('\n== jev_extract: one question per page ==');
for (const p of PAGES) {
  const row = rows.find((r) => r.id === p.id)!;
  if (String(row.warnings).split('|').some((w) => BAD.has(w)) || !texts[p.id]) continue;
  const doc = texts[p.id]!.slice(0, 50000);
  const x = await call(jev, 'jev_extract', {
    document: doc,
    purpose: 'Answer one question from an official page, verbatim.',
    fields: [{ id: 'answer', pattern: p.pattern, description: p.question }],
  });
  const f = x.results?.[0];
  row.jevAnswer = f?.value ?? null; row.jevStatus = f?.status; row.jevConfidence = f?.confidence;
  console.log(' ', pad(p.id, 20), pad(row.jevAnswer, 18), pad(row.jevStatus, 10), num(row.jevConfidence?.toFixed(2), 5), '|', p.question.slice(0, 70));
}

console.log('\n== jev_verify: Sieve\'s currency facts as claims ==');
for (const p of PAGES) {
  const row = rows.find((r) => r.id === p.id)!;
  const money = facts[p.id]!.filter((f: any) => /^(USD|GBP|EUR|ILS|CAD|AUD)/.test(f.unit ?? '')).slice(0, 8);
  if (!money.length || !texts[p.id]) continue;
  const v = await call(jev, 'jev_verify', {
    claims: money.map((f: any) => `The page states ${f.value} ${f.unit} in the context: "${(f.context ?? '').slice(0, 120)}"`),
    evidence: [{ id: 'page', text: texts[p.id]!.slice(0, 50000) }],
  });
  const s = v.summary ?? {};
  row.verified = s.verified; row.contradicted = s.contradicted; row.unsupported = s.unsupported;
  console.log(' ', pad(p.id, 20), `verified ${s.verified ?? 0} contradicted ${s.contradicted ?? 0} unsupported ${s.unsupported ?? 0} of ${money.length}`);
}

save(DIR, 'pages.json', rows);
save(DIR, 'pages.csv', csv(rows.map(({ error, ...r }) => r)));
save(DIR, 'facts.json', facts);
const ok = rows.filter((r) => !String(r.warnings).split('|').some((w) => BAD.has(w)));
console.log(`\n${ok.length}/${rows.length} usable; raw ${rows.reduce((s, r) => s + r.rawTokens, 0)} → state ${rows.reduce((s, r) => s + r.stateTokens, 0)}; block-split on ${rows.filter((r) => r.split).length}`);
await close();
