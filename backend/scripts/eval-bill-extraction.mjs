// Runs the real bill reader over every file in a folder and checks the result
// against what is printed. Calls LlamaCloud (uses credits) - for local testing.
//
//   node scripts/eval-bill-extraction.mjs ../asstes OUT
//
// Expected values live in scripts/bill-expectations.json, keyed by file name.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { extractBillDocuments } from '../src/modules/bills/bill-extraction.service.js';

const folder = process.argv[2] ?? '../asstes';
const direction = process.argv[3] ?? 'OUT';
const expectationsPath = new URL('./bill-expectations.json', import.meta.url);
const expectations = existsSync(expectationsPath) ? JSON.parse(readFileSync(expectationsPath, 'utf8')) : {};

const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.011;
let failures = 0;

for (const file of readdirSync(folder).filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f))) {
  const mime = file.endsWith('.pdf') ? 'application/pdf' : `image/${path.extname(file).slice(1).replace('jpg', 'jpeg')}`;
  const started = Date.now();
  let docs;
  try {
    docs = await extractBillDocuments(readFileSync(path.join(folder, file)), mime, direction);
  } catch (error) {
    console.log(`\n✗ ${file}: ${error.message}`);
    failures += 1;
    continue;
  }
  const want = expectations[file] ?? [];
  console.log(`\n${file}  (${docs.length} bill${docs.length === 1 ? '' : 's'}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (want.length && want.length !== docs.length) {
    console.log(`  ✗ expected ${want.length} bills, got ${docs.length}`);
    failures += 1;
  }

  docs.forEach(({ data }, i) => {
    const exp = want[i] ?? {};
    const problems = [];
    const check = (label, ok, got) => {
      if (!ok) problems.push(`${label}: got ${JSON.stringify(got)}`);
    };
    const expParty = direction === 'IN' ? exp.seller : exp.buyer;
    if (expParty) check('party', (data.partyName ?? '').toLowerCase().includes(expParty.toLowerCase()), data.partyName);
    if (exp.invoiceNumber) check('invoice#', data.invoiceNumber === exp.invoiceNumber, data.invoiceNumber);
    if (exp.invoiceDate) check('date', data.invoiceDate === exp.invoiceDate, data.invoiceDate);
    if (exp.grandTotal) check('total', near(data.grandTotal, exp.grandTotal), data.grandTotal);
    if (exp.subtotal) check('subtotal', near(data.subtotal, exp.subtotal), data.subtotal);
    if (exp.amountPaid !== undefined) check('paid', near(data.amountPaid, exp.amountPaid), data.amountPaid);
    check('gstin is valid or blank', data.partyGstin === null || /^\d{2}[A-Z0-9]{13}$/.test(data.partyGstin), data.partyGstin);
    check('phone has no X', !/x/i.test(data.partyPhone ?? ''), data.partyPhone);
    if (exp.lines) {
      check('line count', data.lines.length === exp.lines.length, data.lines.length);
      exp.lines.forEach((line, j) => {
        const got = data.lines[j] ?? {};
        if (line.quantity) check(`line ${j + 1} qty`, near(got.quantity, line.quantity), got.quantity);
        if (line.unitPrice) check(`line ${j + 1} rate`, near(got.unitPrice, line.unitPrice), got.unitPrice);
        if (line.lineTotal) check(`line ${j + 1} amount`, near(got.lineTotal, line.lineTotal), got.lineTotal);
        if (line.hsnCode) check(`line ${j + 1} hsn`, got.hsnCode === line.hsnCode, got.hsnCode);
        if (line.taxRate) check(`line ${j + 1} tax%`, near(got.taxRate, line.taxRate), got.taxRate);
        if (line.unit) check(`line ${j + 1} unit`, (got.unit ?? '').toLowerCase() === line.unit.toLowerCase(), got.unit);
      });
    }
    console.log(`  [${i + 1}] ${data.invoiceNumber} | ${data.partyName} | ${data.invoiceDate} | total ${data.grandTotal} | paid ${data.amountPaid} | ${data.lines.length} lines`);
    for (const line of data.lines) {
      console.log(`      - ${line.description} | hsn ${line.hsnCode} | ${line.quantity} ${line.unit ?? ''} x ${line.unitPrice} = ${line.lineTotal} | tax ${line.taxRate}%`);
    }
    if (data.warnings?.length) console.log(`      warnings: ${data.warnings.join(' / ')}`);
    if (problems.length) {
      failures += problems.length;
      for (const p of problems) console.log(`    ✗ ${p}`);
    } else if (want.length) {
      console.log('    ✓ matches the printed bill');
    }
  });
}

console.log(`\n${failures === 0 ? 'ALL GOOD' : `${failures} problem(s)`}`);
process.exitCode = failures === 0 ? 0 : 1;
