// Extracts the <script type="text/x-dc"> logic from src/template.html and
// compiles it (syntax only) — catches typos before a browser round-trip.
// Also runs a few pure helpers headlessly to guard the money math.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'template.html'), 'utf8');
const m = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
if (!m) throw new Error('logic script not found');
let src = m[1].replace(/&quot;/g, '"');

// a fixed calendar inside the vm: "now" starts at 2026-09-20 12:00 local time (it keeps ticking, so ids and lock timers stay unique) —
// month-bound reports, due dates and the year in nextNo never depend on the day the checks run; the trial tests below use the same clock
const RealDate = Date, T0 = RealDate.now(), NOW0 = new RealDate(2026, 8, 20, 12, 0, 0).getTime(), clockNow = () => NOW0 + (RealDate.now() - T0);
class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clockNow()])); } static now() { return clockNow(); } }
// query string of a mocked request: the vm has no URL / URLSearchParams — the app builds them with c.qs(), the mock server reads them with this
const qsOf = (path) => Object.fromEntries((String(path).split('?')[1] || '').split('&').filter(Boolean).map(kv => { const [k, v = ''] = kv.split('='); return [decodeURIComponent(k), decodeURIComponent(v)]; }));
const ctx = { window: {}, document: {}, localStorage: null, console, setTimeout, clearTimeout, TextEncoder, Date: FakeDate };
vm.createContext(ctx);
try {
  vm.runInContext('class DCLogic{constructor(p){this.props=p||{};this.state={}} setState(u){const p=typeof u==="function"?u(this.state):u;this.state={...this.state,...p}} forceUpdate(){} }\n' + src + '\n;globalThis.C=Component;', ctx, { filename: 'template.html#logic' });
  console.log('syntax OK');
} catch (e) {
  console.error('SYNTAX ERROR:', e.message);
  process.exit(1);
}

// headless checks of the pure helpers
const C = ctx.C;
const c = new C({});
const eq = (a, b, what) => { const ok = JSON.stringify(a) === JSON.stringify(b); console.log((ok ? 'ok  ' : 'FAIL') + ' ' + what + (ok ? '' : ' -> ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b))); if (!ok) process.exitCode = 1; };

eq(c.toC('18.50'), 1850, 'toC 18.50');
eq(c.toC('18,5'), 1850, 'toC 18,5 (comma)');
eq(c.toC('0.1'), 10, 'toC 0.1');
eq(c.toC('1.999'), null, 'toC rejects 3 decimals');
eq(c.toC('abc'), null, 'toC rejects text');
eq(c.toC(''), null, 'toC empty is null');
eq(c.toQ('1'), 1000, 'toQ 1');
eq(c.toQ('2.5'), 2500, 'toQ 2.5');
eq(c.toQ('0'), null, 'toQ 0 invalid');
eq(c.toBp(''), 0, 'toBp empty = 0');
eq(c.toBp('5'), 500, 'toBp 5%');
eq(c.toBp('12.5%'), 1250, 'toBp 12.5%');
eq(c.toBp('101'), null, 'toBp >100 invalid');
eq(c.grossOf(1850, 18), 2183, 'gross of 18.50 @18%');
eq(c.netOf(2183, 18), 1850, 'net of 21.83 @18%');
eq(c.calcLine({ unit_c: 1850, qm: 120000, rate: 18, bp: 0 }), { sub: 222000, disc: 0, vatc: 39960, tot: 261960 }, 'line 120 × 18.50 (matches seed FSH-00125 line 1)');
eq(c.calcLine({ unit_c: 145, qm: 300000, rate: 18, bp: 500 }), { sub: 41325, disc: 2175, vatc: 7439, tot: 48764 }, 'line 300 × 1.45 −5%');
eq(c.calcLine({ unit_c: 685, qm: 1500, rate: 8, bp: 0 }), { sub: 1028, disc: 0, vatc: 82, tot: 1110 }, 'line 1.5 × 6.85 @8% (rounding)');
eq(c.addDays('2026-09-12', 15), '2026-09-27', 'addDays +15');
eq(c.addDays('2026-12-25', 10), '2027-01-04', 'addDays across year');
eq(c.daysBetween('2026-09-12', '2026-09-15'), 3, 'daysBetween');
eq(c.fmtDate('2026-09-12'), '12.09.2026', 'fmtDate');
eq(c.norm('Çmimi pa TVSH'), 'cmimi pa tvsh', 'norm diacritics');
eq(c.mapColumns(['Klienti', 'NUI', 'Artikulli', 'SKU', 'Sasia', 'Çmimi', 'Zbritja', 'Shënim']), { cust: 0, nui: 1, art: 2, sku: 3, qty: 4, price: 5, disc: 6, note: 7 }, 'mapColumns albanian');
eq(c.mapColumns(['Customer', 'Item', 'Qty', 'Price', 'Discount']), { cust: 0, art: 1, qty: 2, price: 3, disc: 4 }, 'mapColumns english');
eq(c.parseTable('a;b;"c;d"\n1;2;3\n'), { header: ['a', 'b', 'c;d'], rows: [['1', '2', '3']] }, 'parseTable semicolon + quotes');
eq(c.parseTable('a\tb\n1\t2'), { header: ['a', 'b'], rows: [['1', '2']] }, 'parseTable tsv');
eq(c.parseTable('﻿a,b\r\n1,2\r\n,\r\n'), { header: ['a', 'b'], rows: [['1', '2']] }, 'parseTable BOM + CRLF + blank row');

// end-to-end: excel rows -> batch
c.state.db = c.seedDb();
const text = 'Klienti\tNUI\tArtikulli\tSKU\tSasia\tÇmimi\tZbritja\tShënim\n' +
  'Drini Market SH.P.K.\t810456321\tPanel sanduiç 50mm\tPS-050\t120\t\t0\tShtator\n' +
  '\t811203987\t\tKB-325\t300\t1.40\t5\t\n' +
  'sharri tech\t\tNdriçues LED 18W\t\t40\t\t\t\n' +
  'Firma X\t\tPanel sanduiç 50mm\t\t1\t\t\t\n' +
  'Drini Market SH.P.K.\t\tLaminat\t\tabc\t\t\t\n';
const { rows, error } = c.buildExcelRows(text);
eq(error, '', 'excel: no header error');
eq(rows.map(r => !!r.err), [false, false, false, true, true], 'excel: rows 2-4 valid, 5-6 invalid');
eq(rows[3].err.startsWith('Klienti nuk u gjet'), true, 'excel: unknown customer flagged');
eq(rows[4].err.startsWith('Sasia e pavlefshme'), true, 'excel: bad qty flagged');
const batch = c.buildExcelBatch(rows);
eq(batch.map(b => [b.cust.name, b.items.length]), [['Drini Market SH.P.K.', 1], ['Sharri Tech L.L.C.', 2]], 'excel: grouped into 2 invoices (Sharri has 2 lines)');
eq(batch[1].items[0].unit_c, 140, 'excel: explicit price 1.40 respected');
eq(batch[1].items[1].unit_c, 890, 'excel: catalog price used when blank');
eq(c.nextNo('FSH')(1), 'FSH-2026-00126', 'nextNo continues after seed 00125');
eq(c.nextNo('PRO')(1), 'PRO-2026-00001', 'nextNo PRO starts at 1');

// multi-line article editor (tab 1)
const L0 = c.state.m.lines[0];
eq(c.evalLine(L0).err, 'noprod', 'lines: empty line is incomplete');
c.setLine(L0.id, { sku: 'PS-050', artQ: 'Panel sanduiç 50mm', tax: 'E' }); // E = 18% standard (ATK letters)
eq(c.evalLine(c.state.m.lines[0]).line, { sub: 1850, disc: 0, vatc: 333, tot: 2183 }, 'lines: catalog price, qty 1');
c.addLine();
eq(c.state.m.lines.length, 2, 'lines: addLine appends');
eq(c.state.m.lines[1].fresh && !c.state.m.lines[0].fresh, true, 'lines: only the new line is fresh (autofocus)');
c.setLine(c.state.m.lines[1].id, { sku: 'KB-325', artQ: 'Kabllo', tax: 'E', qty: '300', net: '1.40', disc: '5' });
c.setState({ m: { ...c.state.m, sel: { 'Drini Market SH.P.K.': true, 'Zymer Bytyqi B.I.': true } } });
let b = c.buildOneBatch();
eq(b.map(x => [x.cust.name, x.items.length, x.items.reduce((a, i) => a + i.tot, 0)]), [['Drini Market SH.P.K.', 2, 2183 + 47082], ['Zymer Bytyqi B.I.', 2, 2183 + 47082]], 'lines: 2 lines × 2 customers, totals per invoice (21.83 + 470.82)');
eq(b[0].items !== b[1].items && b[0].items[0] !== b[1].items[0], true, 'lines: items are copied per invoice (no shared objects)');
c.addLine();
eq(c.buildOneBatch(), [], 'lines: an incomplete third line blocks the batch');
c.removeLine(c.state.m.lines[2].id);
eq(c.buildOneBatch().length, 2, 'lines: removing it unblocks');
c.removeLine(c.state.m.lines[0].id); c.removeLine(c.state.m.lines[0].id);
eq(c.state.m.lines.length, 1, 'lines: never fewer than one line');

// ── shared data layer: stock, money, ledger ──
c.state.db = c.seedDb();
const db = () => c.state.db;
const stock = (sku) => c.stockOf(sku) / 1000;
eq(['PS-050', 'LM-008', 'CM-425', 'VD-450', 'BJ-015', 'KB-325', 'LED-18', 'RR-001', 'NS-003'].map(stock), [640, 42, 1200, 18, 96, 60, 25, 310, 165], 'seed: computed stock matches the original product table');
eq(db().products.filter(p => c.stockOf(p.sku) < p.minStock).map(p => p.sku).sort(), ['KB-325', 'LED-18', 'LM-008', 'VD-450'], 'seed: 4 low-stock items (as the dashboard alert said)');
eq(c.avgCost(db(), 'KB-325'), Math.round((160 * 82 + 200 * 82) / 360), 'avgCost: weighted by opening + purchases');
eq(c.docStatus(db().invoices.find(r => r.no === 'FSH-2026-00122')), 'Vonuar', 'docStatus: unpaid past due reads Vonuar');
eq(c.docStatus({ ...db().invoices.find(r => r.no === 'FSH-2026-00125'), due: c.fmtDate(c.addDays(c.today(), 5)) }), 'Lëshuar', 'docStatus: not yet due stays Lëshuar (due date relative to today, so the seed never ages into Vonuar)');
const J = c.journal(); const sumL = (i) => J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[i], 0), 0);
eq(sumL(1) === sumL(2), true, 'journal: total debits equal total credits (' + J.length + ' entries)');
const Bl = c.balances(); const assets = ['1000', '1010', '1200', '1300', '2410'].reduce((a, k) => a + Bl[k].bal, 0), liab = Bl['2200'].bal + Bl['2400'].bal, profit = Bl['4000'].bal - Bl['5000'].bal - Bl['6000'].bal;
eq(assets, liab + Bl['3000'].bal + profit, 'balances: assets = liabilities + equity + profit');
eq(Bl['1200'].bal, db().invoices.filter(r => r.status !== 'Draft' && r.status !== 'Anuluar').reduce((a, r) => a + r.total - r.paid, 0), 'balances: receivables = open invoice amounts');
eq(Bl['2200'].bal, db().purchases.filter(p => p.status !== 'Draft' && p.status !== 'Anuluar').reduce((a, p) => a + p.total - p.paid, 0), 'balances: payables = open purchase amounts');
eq(c.accountBalance('bank1'), 1250000 + 93338 + 100000 - db().purchases.find(p => p.no === 'BL-2026-00031').total - 30000 - (41040 + 420000 + 5310 + 80000), 'accountBalance: opening + receipts − purchase payments − expenses');

// ── operations connecting the modules ──
const bankBefore = c.accountBalance('bank1');
c.recordPayment({ kind: 'sale', ref: 'FSH-2026-00125', amount_c: 100000, account: 'bank1', date: '12.09.2026', note: '' });
let inv = db().invoices.find(r => r.no === 'FSH-2026-00125');
eq([inv.paid, inv.status, db().payments[0].ref, c.accountBalance('bank1') - bankBefore], [100000, 'Pjesërisht', 'FSH-2026-00125', 100000], 'recordPayment: partial → Pjesërisht, payment row, bank up');
c.recordPayment({ kind: 'sale', ref: 'FSH-2026-00125', amount_c: 999999, account: 'cash1', date: '12.09.2026', note: '' });
inv = db().invoices.find(r => r.no === 'FSH-2026-00125');
eq([inv.paid, inv.status], [inv.total, 'Paguar'], 'recordPayment: overpayment is capped at the remaining amount → Paguar');
const before = stock('BJ-015');
c.cancelInvoice('FSH-2026-00121'); // unpaid, issued, fiscalisation had FAILED: stock back, failed queue entry withdrawn, no fiscal cancel
eq([db().invoices.find(r => r.no === 'FSH-2026-00121').status, stock('BJ-015') - before, db().queue.find(q => q.ref === 'FSH-2026-00121').status, db().queue[0].kind !== 'Anulim'], ['Anuluar', 30, 'Anuluar', true], 'cancelInvoice (failed fiscal): reverses stock, withdraws the queued request');
const lm = stock('LM-008');
c.cancelInvoice('FSH-2026-00122'); // unpaid, fiscalised → fiscal cancellation queued
eq([stock('LM-008') - lm, db().queue[0].kind, db().queue[0].ref], [85, 'Anulim', 'FSH-2026-00122'], 'cancelInvoice (fiscalised): reverses stock + queues Anulim');
c.cancelInvoice('FSH-2026-00125'); // paid → refused
eq(db().invoices.find(r => r.no === 'FSH-2026-00125').status, 'Paguar', 'cancelInvoice: paid invoice cannot be cancelled');
const vdBefore = stock('VD-450'), apBefore = c.balances()['2200'].bal;
c.receivePurchase('BL-2026-00035'); // draft: 50 pako @ 3.70
eq([db().purchases.find(p => p.no === 'BL-2026-00035').status, stock('VD-450') - vdBefore, c.balances()['2200'].bal - apBefore, db().products.find(p => p.sku === 'VD-450').cost_c], ['Pranuar', 50, db().purchases.find(p => p.no === 'BL-2026-00035').total, 370], 'receivePurchase: stock in, payables up, cost updated');
const cm = stock('CM-425');
const no = c.createPurchase({ supplier: 'Beton & Rërë Kosova SH.P.K.', items: [{ name: 'Çimento 42.5R 50kg', sku: 'CM-425', unit: 'thes', qty: 100, unit_c: 440, rate: 18, disc: 0, sub: 44000, vatc: 7920, tot: 51920 }], date: '2026-09-12', due: '2026-09-27', note: '', receive: true });
eq([no, stock('CM-425') - cm, db().purchases[0].total], ['BL-2026-00036', 100, 51920], 'createPurchase: numbered, received into stock');
const cashBefore = c.accountBalance('cash1');
c.addExpense({ date: '12.09.2026', category: 'Zyra', vendor: 'Viva', desc: 'Letër', net: 1000, rate: 18, account: 'cash1' });
eq([db().expenses[0].total, cashBefore - c.accountBalance('cash1'), db().payments[0].kind], [1180, 1180, 'expense'], 'addExpense: VAT computed, paid from cash, payment row');
c.adjustStock({ sku: 'LED-18', counted_qm: 23000, note: 'numërim', date: '2026-09-12' });
eq([stock('LED-18'), db().movements[db().movements.length - 1].type], [23, 'adjust'], 'adjustStock: books the difference as an adjustment');
const nos = c.issueBatch([{ cust: db().customers[0], items: [{ name: 'Panel sanduiç 50mm', sku: 'PS-050', unit: 'm²', qty: 2, unit_c: 1850, rate: 18, disc: 0, sub: 3700, vatc: 666, tot: 4366 }], note: '' }], 'issue', { date: '2026-09-12', due: '2026-09-27' });
eq([nos, db().invoices[0].fiscal, stock('PS-050')], [['FSH-2026-00126'], 'Në pritje', 638], 'issueBatch (single form): numbered, queued, stock out');
const J2 = c.journal(); eq(J2.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J2.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal still balanced after all operations');
eq(c.pageTable('Bilanci').kpis[3].value, 'Balancuar ✓', 'Bilanci page: balanced');
for (const p of ['Blerje', 'Furnitorë', 'Hyrje', 'Dalje', 'Shpenzime', 'Pagesa', 'Llogari bankare', 'Arkë', 'TVSH', 'Raporte financiare', 'Gjendja', 'Lëvizjet', 'Hyrje në stok', 'Dalje nga stok', 'Inventar', 'Kategoritë', 'Çmimet', 'Ditari', 'Kontot', 'Fitim / Humbje', 'Hyrjet kontabël']) {
  const t = c.pageTable(p); eq(!!t && t.rows.length > 0 && t.cols.length > 0, true, 'pageTable renders: ' + p + ' (' + (t ? t.rows.length : 0) + ' rows)');
}
c.openForm('payment', { docKind: 'purchase', ref: 'BL-2026-00033', party: 'x', amount: '10' }); eq(c.formVals().actions[0].disabled, false, 'form: payment ready with valid amount');
c.openForm('product'); eq(c.formVals().actions[0].disabled, true, 'form: product blocked until filled');
c.openDr('purchase', 'BL-2026-00033'); eq(c.drawerVals().actions.map(a => a.label), ['Regjistro pagesë', 'Kthim te furnitori', 'Printo', 'Anulo'], 'drawer: open purchase actions');
c.openDr('product', 'PS-050'); eq(c.drawerVals().sections[0].rows.length > 3, true, 'drawer: product movement history');

// ── Raporte · Kompania · Cilësime · Admin ──
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null;
eq(['company', 'branches', 'users', 'roles', 'invoiceSettings', 'admin', 'pos', 'audit', 'subscription'].every(k => c.state.db[k] !== undefined), true, 'seedExtras: all sections present');
eq(c.state.db.fiscal, undefined, 'seedExtras: NO web-side fiscal config — fiscalization lives on each till');
for (const rp of ['month', 'prev', 'year', 'all']) { c.state.rp = rp; for (const p of ['R:Shitje', 'R:Blerje', 'R:Financë', 'R:Stok', 'R:POS', 'R:TVSH']) { const t = c.pageTable(p); eq(!!t && t.cols.length > 0, true, 'report ' + p + ' [' + rp + '] (' + (t ? t.rows.length : 0) + ' rows)'); } }
c.state.rp = 'month';
for (const tab of ['Sipas klientit', 'Sipas artikullit', 'Sipas muajit', 'Faturat']) { c.state.rTab = tab; eq(c.pageTable('R:Shitje').rows.length > 0, true, 'report sales tab: ' + tab); }
c.state.rTab = 'Të arkëtueshme (aging)'; { const t = c.pageTable('R:Financë'); eq(t.foot[t.foot.length - 1].t, c.fmt(db().invoices.filter(r => r.kind !== 'Profaturë' && r.status !== 'Draft' && r.status !== 'Anuluar').reduce((a, r) => a + r.total - r.paid, 0)), 'aging total = open receivables'); }
c.state.rTab = 'Libri i shitjes'; { const t = c.pageTable('R:TVSH'); eq(t.rows.length, db().invoices.filter(r => r.kind !== 'Profaturë' && r.status !== 'Draft' && r.status !== 'Anuluar' && c.monthOf(r.date) === c.today().slice(0, 7)).length, 'VAT sales book lists this month\'s issued invoices'); }
c.state.rTab = '';
for (const p of ['Degët', 'Rolet', 'A:Kompanitë', 'A:Abonimet', 'A:Faturat e platformës', 'A:Planet & çmimet', 'A:Përdoruesit e platformës', 'A:Administratorët', 'A:Agjentët', 'A:Radha globale', 'A:Audit log']) { const t = c.pageTable(p); eq(!!t && t.rows.length > 0, true, 'table page: ' + p + ' (' + (t ? t.rows.length : 0) + ' rows)'); }
for (const p of ['Të dhënat e kompanisë', 'Llogaria', 'Pagesat', 'Siguria', 'Njoftimet', 'POS', 'Faturat', 'Tatimet', 'Email', 'Integrimet', 'API', 'R:HR', 'R:Prodhim', 'A:Përmbledhje', 'A:Modulet & flags', 'A:Cilësimet e platformës', 'A:Statusi i sistemit']) { const g = c.settingsPage(p); eq(!!g && g.cards.length > 0, true, 'settings page: ' + p + ' (' + (g ? g.cards.length : 0) + ' cards)'); }
// roles matrix toggle
{ const t = c.pageTable('Rolet'); const cell = t.rows[0].cells[1 + c.ROLES.indexOf('Kasier')]; const before = cell.on; cell.go(); eq(!!db().roles.Kasier.fatura_shiko, !before, 'roles: toggling a permission persists'); eq(db().audit[0].a.includes('Roli Kasier'), true, 'roles: change is audited'); }
// ── fiscalization is till-owned: the web has NO mode config, NO env switch, and never gates issuing ──
eq([typeof c.changeFiscalMode, typeof c.setFiscalEnv, typeof c.apiFiscal, typeof c.fiscalConfigured, typeof c.apiFiscalToDb], ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'], 'fiscal: no web-side mode/env/config functions exist at all');
eq(c.issueBatch([{ cust: db().customers[0], items: [{ name: 'x', sku: 'PS-050', unit: 'm²', qty: 1, unit_c: 1850, rate: 18, disc: 0, sub: 1850, vatc: 333, tot: 2183 }], note: '' }], 'issue', { date: '2026-09-12', due: '2026-09-27' }).length, 1, 'fiscal: invoices issue normally with no web fiscal config (no UNCONFIGURED gate)');
eq(db().queue[0].kind, 'Faturë', 'fiscal: the issued invoice still enters the read-only queue');
// ── ATK Kosovo tax letters (VAT law 03/L-146 + certified SEF coupons): A = exempt, C = 0%, D = 8%, E = 18% ──
eq(Object.fromEntries(Object.entries(c.TAX).map(([k, t]) => [k, t.rate])), { A: 0, C: 0, D: 8, E: 18 }, 'ATK letters: A=0% C=0% D=8% E=18%');
eq([/liruar/i.test(c.TAX.A.name), /redukt/i.test(c.TAX.D.name), /standard/i.test(c.TAX.E.name)], [true, true, true], 'ATK letters: A e liruar, D e reduktuar, E standarde');
eq(db().products.every(p => ['A', 'C', 'D', 'E'].includes(p.tax)), true, 'seed products carry only ATK letters');
eq(db().taxSettings.defaultGroup, 'E', 'default tax group is E (18% standard)');
// one-time migration of pre-ATK books: letters move by their OLD rate (C was 8 → D, D was 18 → E, E was 0 → C); rates and prices never change
{ const old = { v: 2, products: [{ sku: 'X1', tax: 'C', price_c: 100 }, { sku: 'X2', tax: 'D' }, { sku: 'X3', tax: 'E' }, { sku: 'X4', tax: 'A' }, { sku: 'X5', tax: '??' }], taxSettings: { defaultGroup: 'D', atkCodes: { A: 'a', C: 'c', D: 'd', E: 'e' } } };
  const mig = c.migrateTax(old);
  eq(mig.products.map(p => p.tax), ['D', 'E', 'C', 'A', 'E'], 'migration: C(8%)→D, D(18%)→E, E(0%)→C, A stays, unknown → E');
  eq([mig.taxV, mig.products[0].price_c, mig.taxSettings.defaultGroup], [2, 100, 'E'], 'migration: marked v2, prices untouched, default group follows its rate');
  eq(mig.taxSettings.atkCodes, { A: 'a', C: 'e', D: 'c', E: 'd' }, 'migration: ATK codes follow their rate to the new letter');
  eq(c.migrateTax(mig) === mig, true, 'migration: idempotent (taxV=2 short-circuits)'); }
// the catalog push carries letters+rates as PRODUCT data and the printed-coupon header — but NO fiscal steering block
{ const cat = c.posCatalogPayload();
  eq(cat.fiscal, undefined, 'catalog: no fiscal block — the ERP never steers a POS\'s fiscal mode');
  eq(cat.products.every(p => ['A', 'C', 'D', 'E'].includes(p.tax) && p.rate === c.TAX[p.tax].rate), true, 'catalog: every product ships its ATK letter + matching rate');
  eq(Object.keys(cat.company).sort(), ['address', 'fiscal', 'licence', 'name', 'nui', 'phone', 'place', 'unitName', 'unitNo', 'vatNo', 'vatRegistered'], 'catalog: company block = the certified coupon header fields + VAT registration (vatRegistered, vatNo)');
  eq([cat.company.vatRegistered, cat.company.vatNo], [true, '330012345'], 'catalog: seed company is VAT-registered with its VAT number');
  eq([cat.company.nui, cat.company.unitName, cat.company.unitNo, cat.company.licence, cat.company.place, !!cat.company.phone], ['811234567', 'Dega Prishtinë', '412031', 'L5-0412/14.02.2024', 'Prishtinë', true], 'catalog: header values come from company + main branch (unit no, licence, place, phone)');
  eq(cat.branches.map(b => b.unitNo), ['412031', '412032'], 'catalog: every branch carries its own unit number'); }
c.state.db = c.seedDb(); // fresh books for the admin tests below
// admin: plan price change flows to the subscription total
c.openForm('plan', { planKey: 'pro', name: 'Pro', price: '45.00', includedUsers: '2', extraUser: '8.00', invoiceLimit: 'pa limit', posLimit: '5', modules: 'x', days: '' }); c.formVals().actions[0].go();
eq([db().admin.plans.pro.price_c, db().admin.plans.pro.extraUser_c], [4500, 800], 'admin: plan saved');
c.state.section = 'settings'; c.state.page = 'Abonimi'; c.state.admin = false;
{ const v = c.renderVals(); eq([v.planPrice, v.totalPrice], ['€45.00', c.fmt(4500 + 2 * 800) + '/muaj'], 'abonimi: company sees the new plan price (4 users, 2 included)'); }
// admin: feature flag hides the nav item for companies
c.setAdmin('flags', { faturim_masiv: false }); c.state.section = 'shitje'; c.state.page = 'Fatura';
eq(c.renderVals().subnav.some(x => x.label === 'Faturim masiv'), false, 'flags: faturim_masiv off hides the page');
c.setAdmin('flags', { faturim_masiv: true }); eq(c.renderVals().subnav.some(x => x.label === 'Faturim masiv'), true, 'flags: back on shows it');
// admin: suspend tenant via drawer
c.openDr('tenant', 'Drini Market SH.P.K.'); c.drawerVals().actions.find(a => a.label === 'Pezullo').go(); c.state.confirm.ok(); c.state.confirm = null;
eq([db().admin.tenants.find(t => t.name === 'Drini Market SH.P.K.').status, db().admin.audit[0].a.includes('u pezullua')], ['Pezulluar', true], 'admin: tenant suspended + audited');
// invite user, API key, branch
c.openForm('user', { email: 'test@abc-ks.com', role: 'Shitje', branch: 'Dega Prishtinë', dept: 'Shitje' }); c.formVals().actions[0].go();
eq(db().users[db().users.length - 1].status, 'Ftuar', 'users: invite adds a Ftuar user');
c.openForm('apiKey', { name: 'Test', scope: 'lexo', env: 'test' }); c.formVals().actions[0].go();
eq([db().apiKeys.length, !!c.state.secret && c.state.secret.key.startsWith('kf_test_'), db().apiKeys[db().apiKeys.length - 1].prefix.length], [2, true, 12], 'api: key generated, shown once, only prefix stored');
c.openForm('branch', { name: 'Dega Pejë', address: 'Pejë', phone: '', manager: '' }); c.formVals().actions[0].go();
eq(db().branches[db().branches.length - 1].id, 'BR-0003', 'branches: new branch numbered');
// company data flows into the print header
c.setIn('company', { name: 'ABC Test SH.P.K.' }); c.state.section = 'shitje'; c.state.page = 'Fatura'; c.state.drawer = 'FSH-2026-00124';
eq(c.renderVals().pc.name, 'ABC Test SH.P.K.', 'company data → print header');
// full render sweep: every page in both shells renders without throwing and is not "generic" unless expected
c.state.drawer = null;
// only the HR and Prodhim modules are still honest placeholders — every other page must render real data
const genericOk = new Set(['Punëtorët', 'Departamentet', 'Pozitat', 'Orari', 'Pushimet', 'Prezenca', 'Pagat', 'Recetat / BOM', 'Prodhimet', 'Materialet', 'Urdhrat e punës', 'Konsumi', 'Raportet']);
let swept = 0, generic = [];
for (const n of c.NAV) for (const p of n.items) { c.state.admin = false; c.state.section = n.id; c.state.page = p; const v = c.renderVals(); swept++; if (v.isGeneric && !(n.id === 'raporte' ? false : genericOk.has(p))) generic.push(n.id + '/' + p); if (n.id === 'raporte' && v.isGeneric) generic.push('raporte/' + p); }
for (const n of c.ADMIN_NAV) for (const p of n.items) { c.state.admin = true; c.state.section = n.id; c.state.page = p; const v = c.renderVals(); swept++; if (v.isGeneric) generic.push('admin/' + p); }
eq(generic, [], 'render sweep: ' + swept + ' pages rendered; unexpected generic pages');
c.state.admin = false;

// ── POS sync import (what the desktop POS sends over /sales) ──
c.state.db = c.seedDb();
const ledBefore = stock('LED-18'), cashB0 = c.accountBalance('cash1'), bankB = c.accountBalance('bank1');
const rcpt = (id, no, status, fs, items, cash, card, extra = {}) => ({ id, no, shift_id: 'SH-1', pos_id: 'POS-0001', branch: 'Dega Prishtinë', operator: 'Fjolla K.', ts: '2026-09-12 21:30:00', customer: 'Klient me shumicë', customer_nui: '', sub_c: items.reduce((a, i) => a + i.sub_c, 0), vat_c: items.reduce((a, i) => a + i.vat_c, 0), total_c: items.reduce((a, i) => a + i.tot_c, 0), cash_c: cash, card_c: card, change_c: 0, status, fiscal_status: fs, fiscal_ref: fs === 'fiscalized_sim' ? 'SIM-1' : '', fiscal_mode: 'ATK_ELECTRONIC', fiscal_version: 3, fiscal_error: '', orig_id: null, items, ...extra });
const it = (sku, name, qty_m, unit_c, disc_bp = 0) => { const l = c.calcLine({ unit_c, qm: qty_m, rate: 18, bp: disc_bp }); return { sku, name, unit: 'copë', qty_m, unit_c, rate: 18, disc_bp, sub_c: l.sub, vat_c: l.vatc, tot_c: l.tot }; };
const R1 = rcpt('r-1', 'POS-0001/000001', 'final', 'pending', [it('LED-18', 'Ndriçues LED 18W', 4000, 890, 1000)], 3781, 0);
const R2 = rcpt('r-2', 'POS-0001/000002', 'final', 'fiscalized_sim', [it('LED-18', 'Ndriçues LED 18W', 1000, 890)], 0, 1050);
let n1 = c.importPosSales([R1, R2], [{ id: 'SH-1', pos_id: 'POS-0001', branch: 'Dega Prishtinë', operator: 'Fjolla K.', opened_at: '2026-09-12 08:00:00', closed_at: null, opening_c: 10000, status: 'open' }]);
eq([n1.receipts, n1.shifts, db().posReceipts.length, db().posShifts.length], [2, 1, 2, 1], 'pos import: 2 receipts + 1 shift');
eq(stock('LED-18'), ledBefore - 5, 'pos import: stock out 4 + 1');
eq([c.accountBalance('cash1') - cashB0, c.accountBalance('bank1') - bankB], [3781, 1050], 'pos import: cash to Arka 1, card to bank');
eq(db().queue.slice(0, 2).map(q => [q.kind, q.status]), [['Kupon POS', 'E suksesshme'], ['Kupon POS', 'Në pritje']], 'pos import: fiscal queue mirrored (SIM = suksesshme me shënim)');
eq(db().queue[0].reason, 'SIMULATOR — pa vlerë fiskale', 'pos import: simulator labelled in queue');
const J3 = c.journal(); eq(J3.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J3.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with POS receipts');
eq(J3.filter(e => e.ref === 'POS-0001/000001').length, 2, 'journal: POS receipt posts sale + COGS');
// idempotent re-pull: same receipt again (now fiscalised) only updates status
let n2 = c.importPosSales([{ ...R1, fiscal_status: 'fiscalized_sim', fiscal_ref: 'SIM-9' }], []);
eq([n2.receipts, n2.updated, stock('LED-18'), c.accountBalance('cash1') - cashB0, db().posReceipts.find(r => r.id === 'r-1').fiscal], [0, 1, ledBefore - 5, 3781, 'Fiskalizuar (SIM)'], 'pos import: re-pull is idempotent (no stock/cash twice), fiscal status refreshed');
// return receipt
const RR = rcpt('r-3', 'POS-0001/000003', 'return', 'fiscalized_sim', [it('LED-18', 'Ndriçues LED 18W', -2000, 890, 1000)], -1890, 0, { orig_id: 'r-1' });
c.importPosSales([RR, { ...R1, status: 'returned' }], []);
eq([stock('LED-18'), c.accountBalance('cash1') - cashB0, db().posReceipts.find(r => r.id === 'r-1').status], [ledBefore - 3, 3781 - 1890, 'Kthyer'], 'pos import: return puts 2 back, refunds cash, marks original');
// sales aggregates include POS (net of returns)
c.state.section = 'dashboard'; c.state.page = 'Paneli';
{ const sd = c.salesDocs(); eq(sd.filter(x => x.src === 'pos').reduce((a, x) => a + x.sub, 0), R1.sub_c + R2.sub_c + RR.sub_c, 'salesDocs: POS net sales = sales − returns'); }
// A4 invoice from a receipt: linked, paid, no second posting
const led3 = stock('LED-18'), cash3 = c.accountBalance('cash1'), j3 = c.journal().length;
c.invoiceFromReceipt('r-2');
const a4 = db().invoices[0];
eq([a4.fromPos, a4.posNo, a4.status, a4.paid === a4.total, a4.fiscal, stock('LED-18'), c.accountBalance('cash1'), c.journal().length], ['r-2', 'POS-0001/000002', 'Paguar', true, 'Fiskalizuar (SIM)', led3, cash3, j3], 'A4 from receipt: linked & paid, no new stock/cash/journal');
eq(db().posReceipts.find(r => r.id === 'r-2').invoiceNo, a4.no, 'A4 from receipt: receipt links back');
eq(c.salesDocs().filter(x => x.no === a4.no).length, 0, 'A4 from receipt: not counted as a second sale');
eq(c.posCatalogPayload().products.find(p => p.sku === 'LED-18').stock_qm, stock('LED-18') * 1000, 'catalog payload carries live stock');
for (const p of ['P:Arkat', 'P:Shitje', 'P:Kthime', 'P:Operatorët', 'P:Mbyllja e arkës', 'P:Raportet e arkës']) { const t = c.pageTable(p); eq(!!t && t.cols.length > 0, true, 'POS page: ' + p + ' (' + (t ? t.rows.length : 0) + ' rows)'); }
eq(!!c.settingsPage('P:Hap POS-in'), true, 'POS page: Hap POS-in');
c.openDr('pos', 'r-1'); eq(c.drawerVals().actions.some(a => /Kthimi/.test(a.label)), true, 'POS drawer: links original ↔ return');

// ── POS receipt with an invoice-level discount (discount_total_c; the POS already pushed it into the line totals) ──
{ const line = { ...it('LED-18', 'Ndriçues LED 18W', 2000, 890), sub_c: 1695, vat_c: 305, tot_c: 2000 }; // 21.00 gross − 1.00 invoice discount
  const RD = rcpt('r-d1', 'POS-0001/000004', 'final', 'fiscalized_sim', [line], 2000, 0, { discount_total_c: 100 });
  const led = stock('LED-18'), cash = c.accountBalance('cash1');
  c.importPosSales([RD], []); const doc = db().posReceipts.find(r => r.id === 'r-d1');
  eq([doc.discount, doc.total, doc.sub + doc.vat, stock('LED-18'), c.accountBalance('cash1') - cash], [100, 2000, 2000, led - 2, 2000], 'pos discount: receipt keeps discount_total_c, totals net, stock/cash as paid');
  c.openDr('pos', 'r-d1'); const tv = c.drawerVals().totals; eq([tv.map(x => x.k), tv[0].v, tv[1].v], [['Para zbritjes', 'Zbritje totale', 'Neto', 'TVSH', 'Totali'], c.fmt(2100), '−' + c.fmt(100)], 'pos discount: drawer shows gross and "Zbritje totale"');
  c.invoiceFromReceipt('r-d1'); const a4d = db().invoices[0];
  eq([a4d.fromPos, a4d.discount, a4d.total, a4d.paid, a4d.items.reduce((a, i) => a + i.tot, 0)], ['r-d1', 100, 2000, 2000, 2000], 'A4 from a discounted receipt: total == paid == sum of line totals, discount carried');
  const html = c.docPrintHtml(a4d); eq([/Zbritje totale/.test(html), html.includes('−' + c.fmt(100)), html.includes('Totali para zbritjes</span><span>' + c.fmt(2100))], [true, true, true], 'A4 print: "Zbritje totale" line + gross before discount');
  eq(/Zbritje totale/.test(c.docPrintHtml(db().invoices.find(r => r.no === 'FSH-2026-00124'))), false, 'A4 print: no discount line on ordinary invoices');
  c.state.section = 'shitje'; c.state.page = 'Fatura'; c.state.drawer = a4d.no; const vd = c.renderVals(); eq([vd.inv.hasDisc, vd.inv.discFmt, vd.inv.grossFmt], [true, '−' + c.fmt(100), c.fmt(2100)], 'invoice drawer: discount line bound'); c.state.drawer = null; }

// ── CANCEL receipt (ATK CANCEL coupon): status "cancel" + orig_id, original re-sent as "void" ──
{ const led0 = stock('LED-18'), cash0 = c.accountBalance('cash1'), bank0 = c.accountBalance('bank1'), j0 = c.journal().length;
  const R5 = rcpt('r-5', 'POS-0001/000005', 'final', 'fiscalized_sim', [it('LED-18', 'Ndriçues LED 18W', 3000, 890)], 3151, 0, { atk_transaction_id: 'ATK-TX-5' });
  c.importPosSales([R5], []);
  eq([stock('LED-18'), c.accountBalance('cash1') - cash0], [led0 - 3, 3151], 'cancel: original sale booked first');
  // the cancel carries the same lines with POSITIVE amounts (as the POS stores them) — the ERP books it negative regardless of sign
  const RC = rcpt('r-5c', 'POS-0001/000006', 'cancel', 'pending', [it('LED-18', 'Ndriçues LED 18W', 3000, 890)], 3151, 0, { orig_id: 'r-5', atk_transaction_id: 'ATK-TX-6' });
  const nC = c.importPosSales([RC, { ...R5, status: 'void' }], []);
  const canc = db().posReceipts.find(r => r.id === 'r-5c'), orig = db().posReceipts.find(r => r.id === 'r-5');
  eq([nC.receipts, nC.updated, stock('LED-18'), c.accountBalance('cash1') - cash0, c.accountBalance('bank1') - bank0], [1, 1, led0, 0, 0], 'cancel: full reversal — stock back in, cash out, nothing on the bank');
  eq([canc.status, canc.kind, canc.total, canc.sub, canc.items[0].qty, canc.origId, canc.origNo, canc.atkTx], ['Anulim', 'Anulim kuponi POS', -3151, -2670, -3, 'r-5', 'POS-0001/000005', 'ATK-TX-6'], 'cancel: negative document referencing the original');
  eq([orig.status, orig.cancelId, orig.cancelNo, orig.total], ['Anuluar', 'r-5c', 'POS-0001/000006', 3151], 'cancel: original marked Anuluar and linked (its own figures untouched)');
  eq(db().movements.filter(m => m.ref === 'POS-0001/000006').map(m => [m.type, m.qm]), [['sale_cancel', 3000]], 'cancel: stock movement is "Anulim shitje" (+3)');
  eq(db().payments.filter(p => p.ref === 'POS-0001/000006').map(p => [p.dir, p.amount_c, p.note]), [['out', 3151, 'Anulim POS · para']], 'cancel: cash leaves the till account');
  eq([db().queue[0].kind, db().queue[0].ref, db().queue[0].txId, db().queue[0].origNo, /ATK-TX-6/.test(db().queue[0].reason), db().queue[0].status], ['Anulim', 'POS-0001/000006', 'ATK-TX-6', 'POS-0001/000005', true, 'Në pritje'], 'cancel: fiscal queue row kind Anulim with the ATK transaction id');
  const JC = c.journal(); eq(JC.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === JC.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with a cancel');
  eq(JC.filter(e => e.ref === 'POS-0001/000006').map(e => e.desc.slice(0, 14)), ['Anulim kuponi ', 'Anulim kuponi '], 'journal: cancel posts revenue/VAT/cash reversal + stock back at cost');
  { const sd = c.salesDocs().filter(x => x.no === 'POS-0001/000005' || x.no === 'POS-0001/000006'); eq([sd.length, sd.reduce((a, x) => a + x.total, 0), sd.reduce((a, x) => a + x.vat, 0)], [2, 0, 0], 'salesDocs / dashboard / TVSH: sale + cancel net to zero'); }
  // re-sync of the same payloads (now the cancel is fiscalised): idempotent, only the fiscal fields move
  const nR = c.importPosSales([{ ...RC, fiscal_status: 'fiscalized_sim', fiscal_ref: 'SIM-C6' }, { ...R5, status: 'void' }], []);
  eq([nR.receipts, nR.updated, stock('LED-18'), c.accountBalance('cash1') - cash0, db().posReceipts.find(r => r.id === 'r-5c').status, db().posReceipts.find(r => r.id === 'r-5').status, db().posReceipts.find(r => r.id === 'r-5c').fiscal, db().queue[0].status, db().movements.filter(m => m.ref === 'POS-0001/000006').length], [0, 2, led0, 0, 'Anulim', 'Anuluar', 'Fiskalizuar (SIM)', 'E suksesshme', 1], 'cancel: re-sync is idempotent (no double reversal), statuses kept, fiscal refreshed');
  // even if the original is re-sent as "final" later (old POS build), it stays cancelled
  c.importPosSales([R5], []); eq(db().posReceipts.find(r => r.id === 'r-5').status, 'Anuluar', 'cancel: original never reverts from Anuluar');
  // POS › Shitje shows both with the badge "Anuluar"; the drawer links both ways
  c.state.section = 'pos'; c.state.page = 'Shitje'; const tS = c.pageTable('P:Shitje');
  const rowOf = no => tS.rows.find(r => r.cells[0].t === no || r.cells[0].text === no || JSON.stringify(r.cells[0]).includes(no));
  eq([rowOf('POS-0001/000005').cells[9].t, rowOf('POS-0001/000006').cells[9].t, rowOf('POS-0001/000006').cells[9].sub], ['Anuluar', 'Anuluar', 'anulim i POS-0001/000005'], 'POS › Shitje: cancel and original both badged Anuluar');
  c.openDr('pos', 'r-5'); eq([c.drawerVals().actions.some(a => /Anulimi POS-0001\/000006/.test(a.label)), c.drawerVals().badge.text], [true, 'Anuluar'], 'POS drawer: original → its cancel');
  c.openDr('pos', 'r-5c'); eq([c.drawerVals().actions.some(a => /Kuponi origjinal POS-0001\/000005/.test(a.label)), c.drawerVals().meta.some(m => m.k === 'Transaksioni ATK' && m.v === 'ATK-TX-6'), /ATK CANCEL/.test(c.drawerVals().subtitle)], [true, true, true], 'POS drawer: cancel → original, ATK transaction shown');
  c.openDr('queue', 0); eq(c.drawerVals().meta.some(m => m.k === 'Transaksioni ATK' && m.v === 'ATK-TX-6'), true, 'queue drawer: ATK transaction id of the cancel');
  c.state.section = 'raporte'; c.state.page = 'Shitje'; c.state.rTab = 'Faturat'; { const t = c.pageTable('R:Shitje'); eq(!!t && t.rows.length > 0, true, 'Raporte › Shitje renders with cancels'); }
  eq(c.invoiceFromReceipt('r-5'), undefined, 'A4 refused for a cancelled receipt'); eq(db().invoices.some(i => i.fromPos === 'r-5'), false, 'A4 refused for a cancelled receipt (none created)');
  // "void" spelling, no lines of its own, card payment, sent BEFORE its original in the same batch → amounts mirrored from the original
  const R7 = rcpt('r-7', 'POS-0001/000007', 'void', 'fiscalized_sim', [it('LED-18', 'Ndriçues LED 18W', 1000, 890)], 0, 1050, {});
  const RV = { ...rcpt('r-7c', 'POS-0001/000008', 'void', 'fiscalized_sim', [], 0, 0, { reference_id: 'r-7', atk_transaction_id: 'ATK-TX-8' }), sub_c: 0, vat_c: 0, total_c: 0 };
  const led7 = stock('LED-18'), bank7 = c.accountBalance('bank1'), q7 = db().queue.length;
  const n7 = c.importPosSales([RV, R7], []); const c7 = db().posReceipts.find(r => r.id === 'r-7c'), o7 = db().posReceipts.find(r => r.id === 'r-7');
  eq([n7.receipts, stock('LED-18'), c.accountBalance('bank1') - bank7, c7.status, c7.total, c7.card_c, c7.items.length, c7.origNo, o7.status, o7.cancelId, db().queue.length - q7, db().queue.find(q => q.ref === 'POS-0001/000008').kind], [2, led7, 0, 'Anulim', -1050, -1050, 1, 'POS-0001/000007', 'Anuluar', 'r-7c', 2, 'Anulim'], 'cancel ("void" + reference_id, no lines): mirrors the original, card money leaves the bank, original Anuluar');
  const J7 = c.journal(); eq(J7.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J7.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with a card cancel');
  eq(c.importPosSales([{ ...R5, status: 'nonsense' }], []).receipts + c.importPosSales([{ ...R5, status: 'nonsense' }], []).updated, 0, 'unknown receipt statuses are ignored');
  for (const p of ['P:Shitje', 'P:Kthime', 'P:Operatorët', 'P:Raportet e arkës']) { const t = c.pageTable(p); eq(!!t && t.cols.length > 0, true, 'POS page with cancels: ' + p); }
  c.state.section = 'dashboard'; c.state.page = 'Paneli'; c.state.range = 'Gjithçka'; eq(c.renderVals().kpis.length, 8, 'dashboard renders with cancels'); }

// ── operator PINs (hash must equal Python hashlib.sha256 on "salt:pin") ──
eq(c.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 test vector');
eq(c.sha256('a1b2c3d4:0000'), require('crypto').createHash('sha256').update('a1b2c3d4:0000').digest('hex'), 'sha256 matches node crypto (salt:pin)');
eq(c.sha256('Fjolla Kastrati · ë ç'), require('crypto').createHash('sha256').update('Fjolla Kastrati · ë ç').digest('hex'), 'sha256 utf-8 input');
c.state.db = c.seedDb();
eq(db().users.every(u => u.pinHash && u.pinSalt), true, 'pins: every seed user has a salted hash');
eq(c.pinIsDefault(db().users[2]), true, 'pins: default 0000 detected');
c.setUserPin('u3', '2580');
eq([c.pinIsDefault(db().users[2]), c.pinHash('2580', db().users[2].pinSalt) === db().users[2].pinHash, db().audit[0].a.includes('PIN')], [false, true, true], 'pins: set PIN → hash stored, audited');
eq(c.posCatalogPayload().operators.find(o => o.name === 'Fjolla Kastrati').pinHash, db().users[2].pinHash, 'pins: catalog payload carries the hash (never the PIN)');
eq(JSON.stringify(c.posCatalogPayload()).includes('2580'), false, 'pins: PIN itself never leaves the ERP');
c.openForm('pin', { userId: 'u3', pin: '12', pin2: '12' }); eq(c.formVals().actions[1].disabled, true, 'pin form: too short blocked');
c.openForm('pin', { userId: 'u3', pin: '0000', pin2: '0000' }); eq(c.formVals().actions[1].disabled, true, 'pin form: 0000 not allowed as a new PIN');
c.openForm('pin', { userId: 'u3', pin: '123456', pin2: '123456' }); eq(c.formVals().actions[1].disabled, false, 'pin form: 6 digits ok');
{ const t = c.pageTable('P:Operatorët'); eq(t.cols.some(x => x.label === 'PIN i POS-it') && t.rows[0].cells.some(x => x.act), true, 'operatorët page: PIN column + action'); }

// ── credit notes (KR-) and purchase returns (KD-) ──
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null; c.state.drawer = null;
const invOf = no => db().invoices.find(r => r.no === no), purOf = no => db().purchases.find(p => p.no === no);
eq(c.returnable('sale').map(x => x.doc.no).sort(), ['FSH-2026-00120', 'FSH-2026-00121', 'FSH-2026-00122', 'FSH-2026-00123', 'FSH-2026-00124', 'FSH-2026-00125'], 'returnable: only issued invoices (no draft / cancelled / proforma)');
const ps0 = stock('PS-050'), recv0 = c.balances()['1200'].bal;
const kr1 = c.createReturn({ kind: 'sale', ref: 'FSH-2026-00125', items: [{ li: 0, qty: 20 }], date: '2026-09-13', reason: 'dëmtim', account: 'bank1' });
let ret1 = db().returns[0];
eq([kr1, ret1.kind, ret1.sub, ret1.vat, ret1.total, ret1.applied, ret1.refund, ret1.fiscal], ['KR-2026-00001', 'Kthim shitje', 37000, 6660, 43660, 43660, 0, 'Në pritje'], 'credit note: 20 m² × 18.50 @18%, applied to the unpaid invoice, fiscalisation queued');
eq([invOf('FSH-2026-00125').credited, invOf('FSH-2026-00125').status, c.rem(invOf('FSH-2026-00125')), stock('PS-050') - ps0, db().queue[0].kind, db().movements[db().movements.length - 1].type], [43660, 'Pjesërisht', 277064 - 43660, 20, 'Notë krediti', 'sale_return'], 'credit note: invoice credited, stock back, queue entry');
eq(recv0 - c.balances()['1200'].bal, 43660, 'credit note: receivables down by the note');
eq(c.returnable('sale').find(x => x.doc.no === 'FSH-2026-00125').lines[0].left, 100, 'returnable: 100 m² left on the line');
c.createReturn({ kind: 'sale', ref: 'FSH-2026-00125', items: [{ li: 0, qty: 101 }], date: '2026-09-13' }); eq(db().returns.length, 1, 'credit note: more than the remaining qty is refused');
const bank0 = c.accountBalance('bank1'), led0 = stock('LED-18');
const kr2 = c.createReturn({ kind: 'sale', ref: 'FSH-2026-00124', items: [{ li: 1, qty: 10 }], date: '2026-09-13', reason: '', account: 'bank1' }); // paid invoice → refund
let ret2 = db().returns[0];
eq([kr2, ret2.applied, ret2.refund, bank0 - c.accountBalance('bank1'), db().payments[0].kind, db().payments[0].dir, invOf('FSH-2026-00124').status, stock('LED-18') - led0], ['KR-2026-00002', 0, 10502, 10502, 'refund', 'out', 'Paguar', 10], 'credit note on a paid invoice: money refunded from the bank, invoice stays settled');
const Jr = c.journal(); eq(Jr.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === Jr.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with credit notes');
eq(c.balances()['1200'].bal, db().invoices.filter(r => r.kind !== 'Profaturë' && r.status !== 'Draft' && r.status !== 'Anuluar').reduce((a, r) => a + c.rem(r), 0), 'balances: receivables = Σ rem (total − paid − credited)');
eq(c.salesDocs().filter(x => x.src === 'ret').reduce((a, x) => a + x.total, 0), -(43660 + 10502), 'salesDocs: credit notes are negative sales');
c.cancelReturn(kr2);
eq([db().returns.find(r => r.no === kr2).status, c.accountBalance('bank1'), stock('LED-18'), invOf('FSH-2026-00124').credited, db().payments.some(p => p.kind === 'refund' && p.ref === kr2)], ['Anuluar', bank0, led0, 0, false], 'cancelReturn: refund, stock and credit reversed');
c.cancelInvoice('FSH-2026-00125'); eq(invOf('FSH-2026-00125').status, 'Pjesërisht', 'cancelInvoice: refused while a credit note exists');
const cm0 = stock('CM-425'), ap0 = c.balances()['2200'].bal;
const kd1 = c.createReturn({ kind: 'purchase', ref: 'BL-2026-00033', items: [{ li: 0, qty: 100 }], date: '2026-09-13', reason: 'thasë të dëmtuar' });
eq([kd1, db().returns[0].kind, db().returns[0].total, db().returns[0].applied, cm0 - stock('CM-425'), ap0 - c.balances()['2200'].bal, purOf('BL-2026-00033').credited, purOf('BL-2026-00033').status], ['KD-2026-00001', 'Kthim blerje', 50740, 50740, 100, 50740, 50740, 'Pjesërisht'], 'purchase return: stock out at purchase price, payable reduced');
for (const p of ['Kthime', 'Kthime blerjeje']) { const t = c.pageTable(p); eq(!!t && t.rows.length > 0, true, 'returns page: ' + p + ' (' + t.rows.length + ' rows)'); }
c.openDr('return', kr1); eq(c.drawerVals().actions.map(a => a.label), ['Printo', 'Fatura FSH-2026-00125', 'Dërgo me email', 'Anulo'], 'return drawer actions');
c.openForm('return', { docKind: 'sale', ref: 'FSH-2026-00122', q_0: '5' }); { const f = c.formVals(); eq([f.actions[0].disabled, f.fields.some(x => x.label === 'Totali i kthimit')], [false, true], 'return form: quantity typed → ready, totals shown'); }
c.openForm('return', { docKind: 'sale', ref: 'FSH-2026-00122', q_0: '999' }); eq(c.formVals().actions[0].disabled, true, 'return form: over-quantity blocked');

// ── quotes → orders → invoices, purchase orders → purchases ──
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null;
const items1 = [{ name: 'Panel sanduiç 50mm', sku: 'PS-050', unit: 'm²', qty: 10, unit_c: 1850, rate: 18, disc: 0, sub: 18500, vatc: 3330, tot: 21830 }];
const of1 = c.createQuote({ customer: 'Drini Market SH.P.K.', items: items1, date: '2026-09-13', valid: '2026-10-13', note: 'oferta', send: true });
eq([of1, db().quotes[0].status, db().quotes[0].total, stock('PS-050')], ['OF-2026-00001', 'Dërguar', 21830, 640], 'quote: numbered, sent, touches nothing');
c.quoteToOrder(of1); { const f = c.formVals(); eq([c.state.frm.kind, c.state.frm.fromQuote, f.lines.length, f.actions[0].disabled], ['order', of1, 1, false], 'quote → order form pre-filled'); f.actions[0].go(); }
const ps1 = db().orders[0];
eq([ps1.no, ps1.status, ps1.fromQuote, db().quotes[0].status, db().quotes[0].orderNo, c.reservedOf('PS-050')], ['PS-2026-00001', 'Hapur', of1, 'Pranuar', 'PS-2026-00001', 10000], 'order: created from the quote, quote accepted, 10 m² reserved');
c.orderToInvoice(ps1.no); { const f = c.formVals(); eq([c.state.frm.kind, c.state.frm.fromOrder], ['invoice', ps1.no], 'order → invoice form'); f.actions[2].go(); }
const invO = db().invoices[0];
eq([invO.fromOrder, invO.status, db().orders[0].status, db().orders[0].invoiceNo, c.reservedOf('PS-050'), stock('PS-050')], [ps1.no, 'Lëshuar', 'Faturuar', invO.no, 0, 630], 'invoice from order: linked both ways, reservation released, stock out');
c.state.drawer = invO.no; c.state.section = 'shitje'; c.state.page = 'Fatura'; { const v = c.renderVals(); eq([v.invHasSrc, v.invSrcLabel], [true, 'Porosia PS-2026-00001'], 'invoice drawer shows its source'); } c.state.drawer = null;
const pb1 = c.createPo({ supplier: 'Elektro Kos L.L.C.', items: [{ name: 'Ndriçues LED 18W', sku: 'LED-18', unit: 'copë', qty: 30, unit_c: 500, rate: 18, disc: 0, sub: 15000, vatc: 2700, tot: 17700 }], date: '2026-09-13', due: '2026-09-20', note: '', wh: 'W1' });
eq([pb1, c.incomingOf('LED-18'), stock('LED-18')], ['PB-2026-00001', 30000, 25], 'purchase order: 30 incoming, stock untouched');
c.poToPurchase(pb1); { const f = c.formVals(); eq([c.state.frm.kind, c.state.frm.fromPo, c.state.frm.receive], ['purchase', pb1, true], 'PO → purchase form'); f.actions[0].go(); }
eq([db().purchases[0].fromPo, db().purchases[0].status, db().purchaseOrders[0].status, db().purchaseOrders[0].purchaseNo, c.incomingOf('LED-18'), stock('LED-18')], [pb1, 'Pranuar', 'Pranuar', db().purchases[0].no, 0, 55], 'purchase from PO: received, PO closed, incoming cleared');
for (const p of ['Oferta', 'Porosi', 'Porosi blerjeje']) { const t = c.pageTable(p); eq(!!t && t.rows.length > 0, true, 'page: ' + p + ' (' + t.rows.length + ' rows)'); }
c.openDr('quote', of1); eq(c.drawerVals().actions.some(a => a.label === 'Porosia PS-2026-00001'), true, 'quote drawer links the order');
// draft → issue, proforma → invoice
const drNo = c.issueBatch([{ cust: db().customers[1], items: items1, note: '' }], 'draft', { date: '2026-09-13', due: '2026-09-28' })[0];
c.issueDraft(drNo); eq([invOf(drNo).status, invOf(drNo).fiscal, db().queue[0].ref, stock('PS-050')], ['Lëshuar', 'Në pritje', drNo, 620], 'issueDraft: draft issued, queued, stock out');
const proNo = c.issueBatch([{ cust: db().customers[1], items: items1, note: '' }], 'proforma', { date: '2026-09-13', due: '2026-09-28' })[0];
c.openForm('invoice', { customer: db().customers[1].name, customerQ: db().customers[1].name, lines: c.linesFrom(items1), fromProforma: proNo }); c.formVals().actions[2].go();
eq([invOf(proNo).status, invOf(proNo).invoiceNo, db().invoices[0].fromProforma], ['Faturuar', db().invoices[0].no, proNo], 'proforma converted: marked Faturuar and linked');

// ── warehouses & transfers ──
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null;
eq([c.mainWh(), c.stockOfWh('PS-050', 'W1'), c.stockOfWh('PS-050', 'W2')], ['W1', 640000, 0], 'warehouses: opening stock sits in the main warehouse');
const jBefore = c.journal().length, costBefore = c.avgCost(db(), 'PS-050');
const tr1 = c.transferStock({ from: 'W1', to: 'W2', items: [{ name: 'Panel sanduiç 50mm', sku: 'PS-050', unit: 'm²', qty: 50 }], date: '2026-09-13', note: '' });
eq([tr1, c.stockOfWh('PS-050', 'W1'), c.stockOfWh('PS-050', 'W2'), stock('PS-050'), c.avgCost(db(), 'PS-050'), c.journal().length], ['TR-2026-00001', 590000, 50000, 640, costBefore, jBefore], 'transfer: moves quantity between warehouses, total stock, cost and journal unchanged');
c.openForm('transfer', { from: 'W2', to: 'W1', lines: [{ ...c.newLine(), fresh: false, sku: 'PS-050', artQ: 'Panel', qty: '60' }] }); eq([c.formVals().actions[0].disabled, /vetëm/.test(c.formVals().msg)], [true, true], 'transfer form: refuses more than the source warehouse holds');
c.openForm('transfer', { from: 'W2', to: 'W1', lines: [{ ...c.newLine(), fresh: false, sku: 'PS-050', artQ: 'Panel', qty: '20' }] }); eq(c.formVals().noPrice, true, 'transfer form: no price fields'); c.formVals().actions[0].go();
eq([c.stockOfWh('PS-050', 'W1'), c.stockOfWh('PS-050', 'W2')], [610000, 30000], 'transfer back via the form');
c.state.db = { ...db(), terminals: [{ id: 't2', name: 'Arka 2', posId: 'POS-0002', warehouse: 'W2', branch: 'Dega Prizren', status: 'Aktiv' }] }; // the till's warehouse comes from its terminal record
c.importPosSales([rcpt('r-w2', 'POS-0002/000001', 'final', 'fiscalized_sim', [it('PS-050', 'Panel', 5000, 1850)], 10915, 0, { pos_id: 'POS-0002', branch: 'Dega Prizren' })], []);
eq([c.stockOfWh('PS-050', 'W2'), c.accountBalance('cash2') - 64000, db().posReceipts[0].posName], [25000, 10915, 'Arka 2'], 'POS-0002 sells from its terminal warehouse (Depo Prizren) into its cash account (Arka 2)');
for (const p of ['Depo', 'Transferime', 'Njësitë', 'Barkodet', 'Lista e çmimeve', 'Raporte', 'Gjendja', 'Lëvizjet']) { const t = c.pageTable(p); eq(!!t && t.cols.length > 0 && t.rows.length > 0, true, 'page: ' + p + ' (' + t.rows.length + ' rows)'); }
eq(c.pageTable('Gjendja').cols.map(x => x.label).includes('Prishtinë'), true, 'Gjendja shows a column per warehouse');
c.openDr('transfer', tr1); eq(c.drawerVals().sections[0].rows.length, 1, 'transfer drawer');

// ── printing, barcodes, labels, e-mail templates ──
{ const h = c.docPrintHtml(invOf('FSH-2026-00125')); eq([h.includes('FSH-2026-00125'), h.includes('FATURË'), h.includes('Drini Market'), h.includes(c.fmt(277064)), h.includes('KS-TX-7F3A21')], [true, true, true, true, true], 'print html: invoice carries number, title, customer, total, fiscal ref'); }
{ const h = c.docPrintHtml(purOf('BL-2026-00033')); eq([h.includes('BLERJE'), h.includes('FURNITORI')], [true, true], 'print html: purchase document'); }
{ const h = c.docPrintHtml(db().transfers[0]); eq(h.includes('FLETË-TRANSFERIM') && h.includes('→'), true, 'print html: transfer sheet'); }
eq(c.esc('<a href="x">&</a>'), '&lt;a href=&#34;x&#34;&gt;&amp;&lt;/a&gt;', 'esc');
eq(c.ean13Check('590123412345'), '7', 'EAN-13 check digit (5901234123457)');
{ const svg = c.code128Svg('KB-325'); eq([svg.startsWith('<svg'), (svg.match(/<rect/g) || []).length > 20], [true, true], 'code128 svg renders bars'); }
{ const code = c.genBarcode('RR-001'); eq([code.length, code.slice(0, 3), c.ean13Check(code.slice(0, 12))], [13, '200', code[12]], 'internal barcode: 13 digits, prefix 200, valid check digit'); }
c.genBarcodes(); eq(db().products.every(p => /^\d{13}$/.test(p.barcode)), true, 'genBarcodes: every product has a 13-digit barcode');
eq(c.genBarcode('RR-001'), db().products.find(p => p.sku === 'RR-001').barcode, 'internal barcode is deterministic');
c.printDocs([invOf('FSH-2026-00125')]); c.printLabels(db().products.slice(0, 2)); eq(typeof c.state.toast, 'string', 'print: headless environment reports honestly instead of throwing');

// ── dashboard period + real chart, list tools, notifications ──
c.state.db = c.seedDb(); c.state.section = 'dashboard'; c.state.page = 'Paneli';
for (const r of ['Sot', 'Këtë javë', 'Këtë muaj', 'Këtë vit', 'Gjithçka']) { c.state.range = r; const v = c.renderVals(); eq(v.kpis.length === 8 && v.chart.length === 9 && v.ranges.some(x => x.bg === '#fff'), true, 'dashboard range ' + r + ': 8 KPIs, 9-month chart'); }
c.state.range = 'Gjithçka'; { const v = c.renderVals(); eq(v.kpis[0].value, c.fmt(c.salesDocs().reduce((a, r) => a + r.sub, 0)), 'dashboard Gjithçka: sales KPI = all net sales'); eq(v.chart.some(x => x.sh !== '0%'), true, 'chart bars come from the books'); }
c.state.range = 'Këtë muaj'; { const v = c.renderVals(); eq(v.kpis[0].value, c.fmt(c.salesDocs().filter(r => c.monthOf(r.date) === c.today().slice(0, 7)).reduce((a, r) => a + r.sub, 0)), 'dashboard Këtë muaj: sales KPI = this month'); eq(/^Mirë/.test(v.greeting) && v.dashLine.includes('ABC SH.P.K.'), true, 'greeting + date line are computed'); }
{ let v = c.renderVals(); const n = v.alertCount; eq(n > 0, true, 'notifications: unread alerts exist'); v.readAlerts(); v = c.renderVals(); eq([v.alertCount, v.hasUnread], [0, false], 'notifications: marked read, badge gone'); }
c.state.section = 'shitje'; c.state.page = 'Fatura';
{ let v = c.renderVals(); v.invoices[0].toggle(); v.invoices[1].toggle(); v = c.renderVals(); eq([v.hasSel, v.selCount, v.exportLabel], [true, 2, 'Eksporto CSV (2)'], 'invoice list: selection'); v.exportInvoices(); v.printSelected(); v.clearSel(); eq(c.renderVals().hasSel, false, 'invoice list: clear selection'); }
c.state.invSort = 'total_desc'; { const v = c.renderVals(); eq(v.invoices[0].total >= v.invoices[1].total, true, 'invoice list: sort by total'); }
c.state.invSort = 'date_desc'; c.state.invKind = 'Profaturë'; eq(c.renderVals().invoices.length, 0, 'invoice list: kind filter'); c.state.invKind = 'Të gjitha';
c.state.page = 'Klientë'; c.state.cFilter = 'Me borxh'; { const v = c.renderVals(); eq(v.customers.every(x => x.debtC > 0) && v.customers.length > 0, true, 'customers: debt filter'); } c.state.cFilter = 'Të gjitha';
c.state.page = 'Produktet'; c.state.pFilter = 'Nën minimum'; { const v = c.renderVals(); eq(v.products.every(p => p.low) && v.products.length === 4, true, 'products: low-stock filter'); } c.state.pFilter = 'Të gjitha';
c.openDr('customer', 'Drini Market SH.P.K.'); { const d = c.drawerVals(); eq([d.title, d.actions.map(a => a.label), d.sections[0].rows.length > 0], ['Drini Market SH.P.K.', ['Fatura e re', 'Ofertë', 'Shiko faturat', 'Redakto'], true], 'customer drawer'); }
c.openDr('supplier', 'Elektro Kos L.L.C.'); eq(c.drawerVals().actions.map(a => a.label), ['Blerje e re', 'Porosi blerjeje', 'Shiko blerjet', 'Redakto'], 'supplier drawer');
c.openForm('customer', { edit: 'Kosova Print Studio', name: 'Kosova Print Studio SH.P.K.', type: 'Biznes', nui: '810112233', fiscal: '600112233', city: 'Prishtinë', contact: 'Blerim Zeqiri', address: 'Rr. UÇK 41' }); c.formVals().actions[0].go();
eq([db().customers.some(x => x.name === 'Kosova Print Studio SH.P.K.'), invOf('FSH-2026-00119').customer], [true, 'Kosova Print Studio SH.P.K.'], 'edit customer: renamed and documents follow');

// ── login / session (local hash check; the backend takes it over later) ──
c.state.db = c.seedDb(); c.state.session = null; c.state.section = 'dashboard'; c.state.page = 'Paneli';
eq(db().users.every(u => u.pwHash && u.pwSalt) && JSON.stringify(c.posCatalogPayload()).includes('pwHash') === false, true, 'login: every user has a salted password hash and it never goes to the POS');
eq(c.renderVals().needsLogin, true, 'login: no session → login screen');
c.setL({ email: 'arben@abc-ks.com', pw: 'gabim' }); c.login(); eq([!!c.state.session, /gabuar/.test(c.state.login.err)], [false, true], 'login: wrong password refused with a message');
c.setL({ email: 'lum@abc-ks.com', pw: 'kontabo' }); c.login(); eq([!!c.state.session, /Ftesa/.test(c.state.login.err)], [false, true], 'login: invited (not accepted) user cannot sign in');
c.setL({ email: 'ARBEN@abc-ks.com', pw: 'kontabo' }); c.login();
eq([c.state.session.name, c.state.session.role, c.who(), db().audit[0].a, c.state.login.pw], ['Arben Berisha', 'Pronar', 'Arben B.', 'Hyrje në sistem (sesion i mbajtur)', ''], 'login: default password signs in (email case-insensitive), audit names the user, password cleared');
{ const v = c.renderVals(); eq([v.needsLogin, v.userName, v.appVis], [false, 'Arben Berisha', 'visible'], 'login: app visible, header shows the signed-in user'); }
c.recordPayment({ kind: 'sale', ref: 'FSH-2026-00125', amount_c: 1000, account: 'bank1', date: '13.09.2026', note: '' }); eq(db().payments[0].user, 'Arben B.', 'operations record the signed-in user');
c.openForm('password', { cur: 'gabim', pw: 'Kontabo2026!', pw2: 'Kontabo2026!' }); eq(c.formVals().actions[0].disabled, true, 'password form: wrong current password blocks');
c.openForm('password', { cur: 'kontabo', pw: 'short', pw2: 'short' }); eq(c.formVals().actions[0].disabled, true, 'password form: too short blocks');
c.openForm('password', { cur: 'kontabo', pw: 'Kontabo2026!', pw2: 'Kontabo2026!' }); eq(c.formVals().actions[0].disabled, false, 'password form: valid'); c.formVals().actions[0].go();
eq([c.pwIsDefault(db().users[0]), db().audit[0].a.includes('Fjalëkalimi u ndryshua')], [false, true], 'password changed → hash replaced, audited');
c.logout(); eq([c.state.session, c.renderVals().needsLogin, db().audit[0].a], [null, true, 'Dalje nga sistemi'], 'logout clears the session');
c.setL({ email: 'arben@abc-ks.com', pw: 'kontabo' }); c.login(); eq(!!c.state.session, false, 'old password no longer works');
c.setL({ email: 'arben@abc-ks.com', pw: 'Kontabo2026!' }); c.login(); eq(!!c.state.session, true, 'new password works');
c.openDr('user', 'u2'); c.drawerVals(); c.setUserPassword('u2', c.DEFAULT_PW, 'reset'); eq(c.pwIsDefault(db().users[1]), true, 'admin reset → default password again');
c.state.session = null;

// ── API mode (kontabo-backend client) against a mocked server: login, state load/seed, commits with compare-and-set, 409 reload, server-owned mutations ──
// (this server's /health lists no features → no POS ledger: the old /pos/sales relay below is the "feature off" behaviour; the ledger tests follow at the end)
const apiBlock = (async () => {
  const mem = {}; const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  ctx.localStorage = store; ctx.sessionStorage = store; ctx.AbortController = class { constructor() { this.signal = {}; } abort() {} };
  const srv = { version: 0, state: null, users: [{ id: 'm1', userId: 'u1', name: 'Arben Berisha', email: 'arben@abc-ks.com', role: 'Pronar', branch: 'Dega Prishtinë', dept: 'Drejtoria', status: 'Aktiv', last: '—', pinSalt: 'a1b2c3d4', pinHash: 'x' }, { id: 'm2', userId: 'u2', name: 'Fjolla Kastrati', email: 'fjolla@abc-ks.com', role: 'Kasier', branch: 'Dega Prizren', dept: 'Shitje', status: 'Aktiv' }], roles: { Pronar: { fatura_shiko: true }, Kasier: { pos: true } }, fiscal: { mode: 'ATK_ELECTRONIC', version: 3, changedAt: '01.03.2026 10:12', changedBy: 'Arben B.', env: 'TEST', settings: { atk: { appId: 'APP-1' }, tremol: {}, flink: {} }, unresolved: 0 }, audit: [{ id: 1, t: '01.09.2026 08:30', u: 'Arben B.', a: 'seed' }], calls: [] };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  ctx.fetch = async (url, o = {}) => {
    const path = url.replace(/^http:\/\/[^/]+\/api\/v1/, ''), m = o.method || 'GET', body = o.body ? JSON.parse(o.body) : {}; srv.calls.push(m + ' ' + path);
    (srv.hdr = srv.hdr || []).push((o.headers || {})['X-Kontabo-Client']); if (path === '/state/commit' && JSON.stringify(body.patch || {}).includes('"_srv"')) srv.srvCommitted = true;
    const authed = (o.headers || {}).Authorization === 'Bearer acc-1';
    if (path === '/health') return json(200, { ok: true, app: 'Kontabo Backend', version: '0.1.0', db: 'sqlite' });
    if (path === '/auth/login') return body.password === 'kontabo' ? json(200, { accessToken: 'acc-1', refreshToken: 'ref-1', expiresIn: 3600, user: { id: 'u1', name: 'Arben Berisha', email: 'arben@abc-ks.com', isPlatformAdmin: false }, tenant: { id: 't1', name: 'ABC SH.P.K.', role: 'Pronar', branch: 'Dega Prishtinë', perms: { fatura_shiko: true } }, tenants: [{ id: 't1', name: 'ABC SH.P.K.', role: 'Pronar' }, { id: 't2', name: 'Drini Market SH.P.K.', role: 'Kontabilist' }] }) : body.password === 'i-pesti' ? json(401, { error: 'invalid_credentials', message: 'gabim', failsLeft: 0, retryAfter: 30 }) : json(401, { error: 'invalid_credentials', message: 'gabim', failsLeft: 4 });
    if (!authed) return json(401, { error: 'unauthorized', message: 'token' });
    if (path === '/state' && m === 'GET') return json(200, { version: srv.version, state: srv.state });
    if (path === '/state' && m === 'PUT') { if (body.baseVersion !== srv.version) return json(409, { error: 'version_conflict', version: srv.version }); srv.state = body.state; srv.version++; return json(200, { version: srv.version }); }
    if (path === '/state/commit') { if (body.baseVersion !== srv.version) return json(409, { error: 'version_conflict', version: srv.version, state: srv.state }); const ignored = []; for (const k in body.patch) { if (['users', 'roles', 'fiscal', 'audit', 'sessions', 'security', 'profile'].includes(k)) ignored.push(k); else srv.state[k] = body.patch[k]; } srv.version++; return json(200, { version: srv.version, ignored }); }
    if (path === '/users' && m === 'GET') return json(200, { users: srv.users });
    if (path === '/roles' && m === 'GET') return json(200, { roles: srv.roles });
    if (path === '/roles' && m === 'PUT') { srv.roles = body.roles; return json(200, { roles: srv.roles }); }
    if (path === '/fiscal' && m === 'GET') return json(200, srv.fiscal);
    if (path === '/fiscal/mode') { if (body.expectedVersion !== srv.fiscal.version) return json(409, { error: 'version_conflict', version: srv.fiscal.version }); srv.fiscal = { ...srv.fiscal, mode: body.mode, version: srv.fiscal.version + 1, changedBy: 'Arben B.' }; return json(200, { mode: srv.fiscal.mode, version: srv.fiscal.version, changedAt: 'x', changedBy: 'Arben B.' }); }
    if (path === '/fiscal/settings') { srv.fiscal.settings = { atk: body.atk, tremol: body.tremol, flink: body.flink }; return json(200, { settings: srv.fiscal.settings, env: 'TEST' }); }
    if (path.startsWith('/audit')) { if (m === 'POST') { srv.audit.unshift({ id: srv.audit.length + 1, t: 'now', u: 'Arben B.', a: body.action }); return json(200, { item: srv.audit[0] }); } return json(200, { items: srv.audit }); }
    if (/^\/users\/m2\/pin$/.test(path)) { srv.users[1] = { ...srv.users[1], pinSalt: 'ffffffff', pinHash: 'pinned', pinChangedAt: 'now' }; return json(200, { user: srv.users[1] }); }
    if (/^\/users\/m2$/.test(path) && m === 'PATCH') { srv.users[1] = { ...srv.users[1], ...body }; return json(200, { user: srv.users[1] }); }
    if (path === '/users/invite') { srv.users.push({ id: 'm3', userId: 'u3', name: body.email, email: body.email, role: body.role, branch: body.branch, dept: body.dept, status: 'Ftuar' }); return json(200, { user: srv.users[2], inviteToken: 'inv-123' }); }
    if (path === '/terminals' && m === 'GET') return json(200, { terminals: srv.terminals || [] });
    if (path === '/terminals' && m === 'POST') { srv.terminals = [...(srv.terminals || []), { id: 'tm1', name: body.name, branch: body.branch, posId: body.posId, warehouse: body.warehouse, status: 'Aktiv', lastSeen: '' }]; return json(200, { terminal: srv.terminals[0], token: 'kt_secret123' }); }
    if (/^\/terminals\/tm1$/.test(path) && m === 'PATCH') { srv.terminals[0] = { ...srv.terminals[0], ...body }; return json(200, { terminal: srv.terminals[0] }); }
    if (path === '/pos/status') return json(200, { terminals: (srv.terminals || []).map(t => ({ id: t.id, lastSeen: '13.09.2026 12:00', appVersion: '0.6.0', catalogVersion: srv.catVersion || 0, shift: null, fiscal: { mode: 'TREMOL_ETHERNET', env: 'PROD', version: 2, simulator: false, pending: 1 }, pendingReceipts: 1 })), catalogVersion: srv.catVersion || 0, unsyncedReceipts: (srv.posReceipts || []).filter(r => !r.acked).length });
    if (path.startsWith('/pos/sales')) { const since = +(qsOf(path).since || 0); const rows = (srv.posReceipts || []).filter(r => r.seq > since); return json(200, { receipts: rows.map(r => r.payload), shifts: [], cursor: rows.length ? rows[rows.length - 1].seq : since }); }
    if (path === '/pos/ack') { for (const r of (srv.posReceipts || [])) if (body.ids.includes(r.payload.id)) r.acked = true; return json(200, { acked: body.ids.length }); }
    if (path === '/pos/catalog' && m === 'PUT') { srv.catVersion = (srv.catVersion || 0) + 1; srv.catalog = body.catalog; return json(200, { version: srv.catVersion }); }
    if (path === '/auth/logout') return json(200, { ok: true });
    return json(404, { error: 'not_found', message: path });
  };
  const wait = () => new Promise(r => setTimeout(r, 5));
  const a = new C({}); a.state.db = null; a.state.session = null;
  a.saveApi({ url: 'http://127.0.0.1:8800/api/v1' });
  eq([a.apiOn(), a.apiAuthed()], [true, false], 'api: url set → API mode, not authenticated yet');
  a.setL({ email: 'arben@abc-ks.com', pw: 'gabim' }); a.login(); for (let i = 0; i < 20 && a.state.login.busy; i++) await wait();
  eq([!!a.state.session, a.state.login.err.startsWith('Email ose fjalëkalim i gabuar')], [false, true], 'api login: server 401 shown');
  a.setL({ email: 'arben@abc-ks.com', pw: 'i-pesti' }); a.login(); for (let i = 0; i < 20 && a.state.login.busy; i++) await wait();
  eq([!!a.state.session, a.state.login.err], [false, 'Shumë tentime të gabuara — llogaria u bllokua për 30 s.'], 'api login: 5th failure (failsLeft 0 + retryAfter) says the account is locked, not "0 tentime"');
  a.setL({ email: 'arben@abc-ks.com', pw: 'kontabo', remember: true }); a.login(); for (let i = 0; i < 50 && (!a.state.db || !a.state.session || !a.state.session.userId); i++) await wait();
  eq([a.state.session.name, a.state.session.userId, a.state.session.api, a.apiAuthed(), a.apiCfg().tenantName], ['Arben Berisha', 'm1', true, true, 'ABC SH.P.K.'], 'api login: session from the server, membership id resolved');
  eq([srv.version, srv.state.invoices.length, srv.state.products.length, srv.state.company.name, srv.state.accounts.length, srv.state.users === undefined, srv.state.fiscal === undefined], [1, 0, 0, 'ABC SH.P.K.', 2, true, true], 'api load: a new tenant starts EMPTY on the server (no demo books, no server-owned keys)');
  eq([a.state.db.users.length, a.state.db.users[1].c.startsWith('#'), a.state.db.roles.Kasier.pos, a.state.db.audit[0].a, a.state.db.company.name], [2, true, true, 'seed', 'ABC SH.P.K.'], 'api load: users/roles/audit mirrored from the server');
  eq([a.state.db.fiscal, srv.calls.includes('GET /fiscal')], [undefined, false], 'api load: NO fiscal mirror — the web fetches no fiscal config from the server');
  { const v = a.renderVals(); eq([v.needsLogin, v.hasTenants, v.tenantList.length, /libri v1/.test(v.apiLine), v.hasSaved], [false, true, 2, true, false], 'api render: signed in, tenant switcher, server line'); }
  // a normal commit → /state/commit with the patch, version advances; server-owned keys are stripped client-side
  a.addParty('customer', { name: 'Test Klient', type: 'Biznes', nui: '123456789', fiscal: '—', city: 'Prishtinë', contact: '—', address: '—' });
  const nos = a.issueBatch([{ cust: a.state.db.customers[0], items: [{ name: 'P', sku: 'P1', unit: 'copë', qty: 1, unit_c: 1000, rate: 18, disc: 0, sub: 1000, vatc: 180, tot: 1180 }], note: '' }], 'issue', { date: '2026-09-13', due: '2026-09-28' });
  a.recordPayment({ kind: 'sale', ref: nos[0], amount_c: 1000, account: 'bank1', date: '13.09.2026', note: '' }); for (let i = 0; i < 40 && (a._pending || []).length; i++) await wait();
  eq([srv.version, a.apiCfg().version, srv.state.payments[0].amount_c, srv.state.invoices.length, (a._pending || []).length], [4, 4, 1000, 1, 0], 'api commit: patches applied on the server in order, version in sync');
  { const before = srv.calls.filter(c => c === 'POST /state/commit').length; a.commit({ security: { twoFactor: true } }); await wait(); eq(srv.calls.filter(c => c === 'POST /state/commit').length, before, 'api commit: server-owned keys are never sent'); }
  // conflict: someone else bumped the version → 409 → server state wins, local change discarded
  srv.version = 5; srv.state.company = { ...srv.state.company, name: 'ABC (server)' };
  a.setIn('company', { name: 'ABC (local)' }); for (let i = 0; i < 50 && (a._pending.length || a._flushing); i++) await wait();
  eq([a.apiCfg().version, a.state.db.company.name, /ringarkuan/.test(a.state.toast || '')], [5, 'ABC (server)', true], 'api commit: 409 → reload from the server + honest toast');
  // reload after a conflict: a server product carrying a category missing from the list → the appended record is persisted (ONE {categories} patch); none when the list is complete
  { srv.state.products = [{ name: 'Q', sku: 'Q1', barcode: '—', cat: 'Hidraulikë', unit: 'copë', tax: 'E', price_c: 100, cost_c: 50, openCost_c: 50, opening: 0, minStock: 0 }]; srv.state.categories = []; srv.version = 6;
    const seen = (a._pending || []).length; await a.apiReloadState(); const patch = (a._pending || [])[seen];
    eq([a.state.db.categories.map(x => x.name), !!patch && Object.keys(patch).join(), patch && patch.categories.map(x => x.id).join()], [['Hidraulikë'], 'categories', 'K-hidraulike'], 'apiReloadState: unknown category → record shown AND queued as a {categories} commit');
    for (let i = 0; i < 40 && ((a._pending || []).length || a._flushing); i++) await wait();
    eq([srv.state.categories.map(x => x.name), srv.version, a.apiCfg().version], [['Hidraulikë'], 7, 7], 'apiReloadState: the record reached the server, version in sync');
    const before = (a._pending || []).length, calls = srv.calls.length; await a.apiReloadState(); eq([(a._pending || []).length - before, srv.calls.slice(calls).filter(x => x === 'POST /state/commit').length], [0, 0], 'apiReloadState: complete list → nothing queued, no commit'); }
  // server-owned mutations
  a.setUserPin('m2', '2580'); for (let i = 0; i < 30 && a.state.db.users[1].pinHash !== 'pinned'; i++) await wait(); eq([srv.calls.includes('POST /users/m2/pin'), a.state.db.users[1].pinHash], [true, 'pinned'], 'api: PIN set on the server, mirror refreshed');
  a.openDr('user', 'm2'); a.drawerVals().actions.find(x => x.label === 'Pezullo').go(); a.state.confirm.ok(); a.state.confirm = null; for (let i = 0; i < 30 && a.state.db.users[1].status !== 'Pezulluar'; i++) await wait(); eq(a.state.db.users[1].status, 'Pezulluar', 'api: suspend → PATCH /users/{id}');
  a.openForm('user', { email: 'test@abc-ks.com', role: 'Shitje', branch: 'Dega Prishtinë', dept: '' }); a.formVals().actions[0].go(); for (let i = 0; i < 30 && a.state.db.users.length < 3; i++) await wait(); eq([a.state.db.users[2].status, !!a.state.confirm && /inv-123/.test(a.state.confirm.body)], ['Ftuar', true], 'api: invite → server, dev token shown'); a.state.confirm = null;
  { const t = a.pageTable('Rolet'); t.rows[0].cells[1 + a.ROLES.indexOf('Kasier')].go(); for (let i = 0; i < 30 && !srv.calls.includes('PUT /roles'); i++) await wait(); eq(srv.roles.Kasier.fatura_shiko, true, 'api: roles matrix → PUT /roles'); }
  // fiscalization is till-owned: the web must NEVER write fiscal config to the server
  eq(srv.calls.filter(x => /\/fiscal/.test(x)), [], 'api: zero /fiscal calls of any kind from the web (no mode PUT, no settings PUT, no GET)');
  eq(srv.fiscal.mode, 'ATK_ELECTRONIC', 'api: server-side fiscal record untouched by the web');
  a.logAudit('test audit'); await wait(); eq([srv.audit[0].a, a.state.db.audit[0].a], ['test audit', 'test audit'], 'api: audit → POST /audit + local mirror');
  // POS relay through the server: register a terminal (token once), push the catalogue, pull receipts, ack
  a.openForm('terminal', { name: 'Arka 1', posId: 'POS-0001', branch: 'Dega kryesore', warehouse: 'W1' }); a.formVals().actions[0].go(); for (let i = 0; i < 30 && !(a.state.db.terminals || []).length; i++) await wait();
  eq([(a.state.db.terminals || []).length, !!a.state.confirm && /kt_secret123/.test(a.state.confirm.body)], [1, true], 'api: terminal registered on the server, token shown once'); a.state.confirm = null;
  srv.posReceipts = [{ seq: 1, payload: rcpt('srv-r1', 'POS-0001/000001', 'final', 'fiscalized_sim', [it('P1', 'P', 1000, 1000)], 1180, 0) }];
  a.state.db = { ...a.state.db, products: [{ name: 'P', sku: 'P1', barcode: '—', cat: 'x', unit: 'copë', tax: 'D', price_c: 1000, cost_c: 500, openCost_c: 500, opening: 10000, minStock: 0 }] };
  await a.posSync(true); for (let i = 0; i < 30 && (a._pending || []).length; i++) await wait();
  eq([srv.calls.includes('PUT /pos/catalog'), srv.calls.some(x => x.startsWith('GET /pos/sales')), srv.calls.includes('POST /pos/ack'), a.state.db.posReceipts.length, a.state.db.posReceipts[0].posName, a.posCfg().cursorSrv, srv.posReceipts[0].acked, !!srv.catalog && srv.catalog.products.length], [true, true, true, 1, 'Arka 1', 1, true, 1], 'api relay: catalogue pushed, receipt pulled into the books, acked, cursor saved');
  await a.posSync(true); eq(a.state.db.posReceipts.length, 1, 'api relay: second pull is idempotent');
  eq([a._ledger, srv.calls.includes('GET /health'), srv.calls.some(x => x.startsWith('GET /pos/ledger')), srv.hdr.every(v => v === '2'), !!srv.srvCommitted], [null, true, false, true, false], 'feature off (/health without posLedger:1): no POS ledger, the relay above works as before; X-Kontabo-Client: 2 on every call');
  // the till's heartbeat fiscal block is kept on the terminal and rendered by the read-only monitor
  { const t0 = a.state.db.terminals[0]; eq([!!t0.fiscal, t0.fiscal.mode, t0.fiscal.env, t0.pendingReceipts], [true, 'TREMOL_ETHERNET', 'PROD', 1], 'api: apiTerminalToDb keeps the heartbeat fiscal block'); }
  { a.state.admin = false; a.state.section = 'settings'; a.state.page = 'Fiskalizimi'; const v = a.renderVals();
    eq([v.fiscalTerms.length, v.fiscalTerms[0].mode, v.fiscalTerms[0].env, v.fiscalTerms[0].ver, v.fiscalTerms[0].pending], [1, 'TREMOL_ETHERNET', 'PROD', 'v2', '1'], 'api: monitor shows per-till fiscal state exactly as reported');
    eq([v.fiscalModes, v.fiscalFields, v.fiscalEnvs, v.fiscalStatus, v.setUnconfigured], [undefined, undefined, undefined, undefined, undefined], 'api: the page exposes no fiscal configuration controls'); }
  // owner-only "Zbraz librat e kompanisë": PUT /state with empty books, server-owned keys untouched, audited
  { a.state.section = 'shitje'; a.state.page = 'Fatura'; const v = a.renderVals(); eq([v.canEmptyBooks, v.hasSaved], [true, false], 'api: owner sees "Zbraz librat", not the local demo reset'); v.emptyBooksConfirm(); eq(!!a.state.confirm && /Zbraz/.test(a.state.confirm.title), true, 'api: emptying the books asks first');
    const usersBefore = a.state.db.users.length; a.state.confirm.ok(); a.state.confirm = null; for (let i = 0; i < 20 && a.state.db.posReceipts.length; i++) await wait();
    eq([a.state.db.posReceipts.length, a.state.db.invoices.length, a.state.db.customers.length, a.state.db.company.name, a.state.db.users.length, srv.state.invoices.length, srv.state.users, a.state.db.audit.some(x => /zbrazën/.test(x.a))], [0, 0, 0, 'ABC SH.P.K.', usersBefore, 0, undefined, true], 'api: books emptied on the server, users/roles kept, audit written');
    a.state.session = { ...a.state.session, role: 'Kasier' }; eq(a.renderVals().canEmptyBooks, false, 'api: only the owner can empty the books'); a.state.session = { ...a.state.session, role: 'Pronar' }; }
  a.logout(); await wait(); eq([a.state.session, a.apiAuthed(), srv.calls.includes('POST /auth/logout')], [null, false, true], 'api: logout revokes the refresh token and clears tokens');
  // platform admin without a tenant: login must not hang; lands in the admin panel on local demo books
  const loginAdmin = ctx.fetch; ctx.fetch = async (url, o = {}) => { const path = url.replace(/^http:\/\/[^/]+\/api\/v1/, ''); srv.calls.push((o.method || 'GET') + ' ' + path); if (path === '/auth/login') return json(200, { accessToken: 'acc-2', refreshToken: 'ref-2', expiresIn: 3600, user: { id: 'u9', name: 'Admin Kontabo', email: 'admin@kontabo.app', isPlatformAdmin: true }, tenant: null, tenants: [] });
    if ((o.headers || {}).Authorization === 'Bearer acc-2') { if (path === '/admin/tenants/t1/owner-password') return json(200, { email: 'pronar@abc-ks.com', password: JSON.parse(o.body || '{}').password || 'Gjeneruar123', created: false, activated: true });
      if (path === '/admin/tenants') return json(200, { tenants: [{ id: 't1', name: 'ABC SH.P.K.', nui: '810000001', city: 'Prishtinë', plan: 'pro', status: 'Aktiv', users: 3 }] }); if (path === '/admin/plans') return json(200, { plans: {} }); if (path === '/admin/flags') return json(200, { flags: {} }); if (path.startsWith('/admin/audit')) return json(200, { items: [{ t: 'now', u: 'admin', a: 'login' }] }); if (path === '/admin/users') return json(200, { users: [{ id: 'm1', userId: 'u1', tenantId: 't1', name: 'Arben Berisha', email: 'arben@abc-ks.com', tenant: 'ABC SH.P.K.', role: 'Pronar', status: 'Aktiv', last: '', isPlatformAdmin: false }] }); if (path === '/auth/logout') return json(200, { ok: true }); }
    return loginAdmin(url, o); };
  a.setL({ email: 'admin@kontabo.app', pw: 'x', remember: true }); a.login(); for (let i = 0; i < 40 && a.state.login.busy; i++) await wait(); for (let i = 0; i < 20 && !a.state.db.admin.tenants.length; i++) await wait();
  eq([a.state.login.busy, !!a.state.session && a.state.session.noTenant, a.state.admin, a.state.page, a.apiAuthed(), a.apiSignedIn(), !!a.state.db], [false, true, true, 'Përmbledhje', false, true, true], 'api: platform admin (no tenant) → admin panel, no hang, local books');
  eq([a.state.db.invoices.length, a.state.db.customers.length, a.state.db.company.name, a.state.db.admin.tenants.length, a.state.db.admin.tenants[0].name, a.state.db.admin.admins[0].email, a.renderVals().userName, a.renderVals().isTrial], [0, 0, 'Kontabo', 1, 'ABC SH.P.K.', 'admin@kontabo.app', 'Admin Kontabo', false], 'api: platform admin sees no demo books; companies come from /admin/tenants; avatar is the admin');
  { a.state.section = 'a_users'; a.state.page = 'Përdoruesit e platformës'; const t = a.pageTable('A:Përdoruesit e platformës'); eq([String(t.count), t.rows.length, a.state.db.admin.users[0].email], ['1', 1, 'arben@abc-ks.com'], 'api: platform users come from /admin/users — no invented owner rows'); }
  // "Fjalëkalimi i pronarit": pa SMTP, administratori ia vendos vetë fjalëkalimin pronarit të kompanisë
  { a.openDr('tenant', 'ABC SH.P.K.'); const acts = a.drawerVals().actions.map(x => x.label);
    eq(acts.includes('Fjalëkalimi i pronarit'), true, 'admin: the tenant drawer offers "Fjalëkalimi i pronarit"');
    a.drawerVals().actions.find(x => x.label === 'Fjalëkalimi i pronarit').go();
    let f = a.formVals(); eq([a.state.frm.kind, f.actions[0].disabled], ['ownerPw', false], 'admin: the form opens, an empty password is allowed (the server generates one)');
    a.setF({ pw: 'short' }); f = a.formVals(); eq(f.actions[0].disabled, true, 'admin: a password under 8 characters is refused before the request');
    a.setF({ pw: 'Fjalekalimi1' }); f = a.formVals(); f.actions[0].go();
    for (let i = 0; i < 20 && !a.state.confirm; i++) await wait();
    eq([srv.calls.includes('POST /admin/tenants/t1/owner-password'), /pronar@abc-ks\.com/.test((a.state.confirm || {}).body || ''), /Fjalekalimi1/.test((a.state.confirm || {}).body || '')], [true, true, true],
       'admin: the password reaches the server and comes back once, with the owner e-mail');
    a.state.confirm = null; a.state.dr = null; }
  a.exitAdmin(); eq(a.state.admin, true, 'api: platform admin cannot enter a company ERP');
  a.logout(); await wait(); eq(a.state.session, null, 'api: platform admin logout');
  ctx.fetch = loginAdmin;
  // ── sign-up of a new company (POST /auth/signup) ──
  // local mode: the link keeps the honest "needs backend" toast and never opens the view
  { const loc = new C({}); loc._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' }; loc.state.db = loc.seedDb(); loc.state.session = null;
    loc.renderVals().lSignup(); eq([loc.state.login.view, /Regjistrimi i kompanisë së re/.test(loc.state.toast || '') && /kërkon backend/.test(loc.state.toast || ''), loc.renderVals().lIsSignup], ['login', true, false], 'signup local: link → needsBackend toast, view stays login'); clearTimeout(loc._t); }
  // API mode: the mocked server answers /auth/signup; the new tenant (acc-9) has no state yet → the ERP seeds empty books
  const sg = { calls: [], bodies: [], reply: null, state: null, version: 0 };
  ctx.fetch = async (url, o = {}) => { const path = url.replace(/^http:\/\/[^/]+\/api\/v1/, ''), m = o.method || 'GET', body = o.body ? JSON.parse(o.body) : {};
    if (path === '/auth/signup') { srv.calls.push(m + ' ' + path); sg.bodies.push({ body, auth: (o.headers || {}).Authorization || null }); return sg.reply || json(200, { accessToken: 'acc-9', refreshToken: 'ref-9', expiresIn: 3600, user: { id: 'u7', name: 'Blerta Gashi', email: 'blerta@firma-re.com', isPlatformAdmin: false }, tenant: { id: 't9', name: 'Firma e Re SH.P.K.', role: 'Pronar', branch: '', perms: { fatura_shiko: true }, plan: 'trial', status: 'Provë', createdAt: new RealDate(clockNow() - 23 * 3600000).toISOString(), trialEndsAt: new RealDate(clockNow() + 13 * 86400000 + 3600000).toISOString(), trialDaysLeft: 14 }, tenants: [{ id: 't9', name: 'Firma e Re SH.P.K.', role: 'Pronar', status: 'Aktiv' }] }); }
    if ((o.headers || {}).Authorization === 'Bearer acc-9') { srv.calls.push(m + ' ' + path);
      if (path === '/state' && m === 'GET') return json(200, { version: sg.version, state: sg.state });
      if (path === '/state' && m === 'PUT') { if (body.baseVersion !== sg.version) return json(409, { error: 'version_conflict', version: sg.version }); sg.state = body.state; sg.version++; return json(200, { version: sg.version }); }
      if (path === '/users') return json(200, { users: [{ id: 'm9', userId: 'u7', name: 'Blerta Gashi', email: 'blerta@firma-re.com', role: 'Pronar', branch: '—', dept: '—', status: 'Aktiv' }] });
      if (path === '/roles') return json(200, { roles: { Pronar: { fatura_shiko: true } } });
      if (path === '/fiscal') return json(200, { mode: 'UNCONFIGURED', version: 0, settings: {} });
      if (path.startsWith('/audit')) return json(200, { items: [{ id: 1, t: 'now', u: 'Blerta G.', a: 'Kompania “Firma e Re SH.P.K.” u regjistrua nga Blerta Gashi' }] });
      if (path === '/terminals') return json(200, { terminals: [] });
      if (path === '/auth/logout') return json(200, { ok: true }); }
    return loginAdmin(url, o); };
  a.renderVals().lSignup(); eq([a.state.login.view, a.renderVals().lIsSignup, a.renderVals().lCanSignup, a.renderVals().lSignupLabel], ['signup', true, false, 'Krijo kompaninë dhe hyr →'], 'signup api: link opens the signup view, button disabled while empty');
  a.setL({ sgCompany: 'Firma e Re SH.P.K.', sgName: 'Blerta Gashi', sgEmail: 'Blerta@Firma-Re.com', sgPw: 'Sekret123', sgPw2: 'Sekret12' }); { const v = a.renderVals(); eq([v.lCanSignup, v.lSgPwMismatch], [false, true], 'signup: passwords must match (client-side message)'); }
  a.setL({ sgPw2: 'Sekret123', sgNui: '12345' }); { const v = a.renderVals(); eq([v.lCanSignup, v.lSgNuiBad], [false, true], 'signup: NUI must be 6–12 digits when given'); }
  a.setL({ sgNui: 'abc' }); eq(a.renderVals().lCanSignup, false, 'signup: non-numeric NUI blocks');
  a.setL({ sgNui: '', sgEmail: 'blerta@firma' }); eq(a.renderVals().lCanSignup, false, 'signup: invalid email blocks');
  a.setL({ sgEmail: 'Blerta@Firma-Re.com', sgPw: 'Sekret1', sgPw2: 'Sekret1' }); eq(a.renderVals().lCanSignup, false, 'signup: password shorter than 8 blocks');
  a.setL({ sgPw: 'Sekret123', sgPw2: 'Sekret123', sgCompany: 'F' }); eq(a.renderVals().lCanSignup, false, 'signup: company name shorter than 2 blocks');
  a.setL({ sgCompany: 'Firma e Re SH.P.K.', sgNui: '811223344', sgCity: 'Prishtinë', remember: true }); eq([a.renderVals().lCanSignup, a.renderVals().lSgNuiBad, a.renderVals().lSgPwMismatch], [true, false, false], 'signup: all required fields valid → button enabled');
  // error mapping by e.code (Albanian), busy reset on failure
  const tryErr = async (reply, want, what) => { sg.reply = reply; a.renderVals().lDoSignup(); eq(a.state.login.busy, true, what + ' (busy while posting)'); for (let i = 0; i < 30 && a.state.login.busy; i++) await wait(); eq([a.state.login.busy, a.state.login.err, !!a.state.session, a.state.login.view], [false, want, false, 'signup'], what); };
  await tryErr(json(409, { error: 'duplicate_name', message: 'x' }), 'Ekziston një kompani me këtë emër.', 'signup err: duplicate_name');
  await tryErr(json(409, { error: 'duplicate_nui', message: 'x' }), 'Ekziston një kompani me këtë NUI.', 'signup err: duplicate_nui');
  await tryErr(json(401, { error: 'invalid_credentials', message: 'x', failsLeft: 3 }), 'Ky email ka tashmë llogari Kontabo — shkruani fjalëkalimin e asaj llogarie (edhe 3 tentime).', 'signup err: invalid_credentials + failsLeft');
  await tryErr(json(401, { error: 'invalid_credentials', message: 'x', failsLeft: 0, retryAfter: 30 }), 'Shumë tentime — llogaria u bllokua për 30 s.', 'signup err: 5th failure (failsLeft 0 + retryAfter) → locked message, not "edhe 0 tentime"');
  await tryErr(json(409, { error: 'email_invited', message: 'x' }), 'Ky email ka një ftesë në pritje — pranoni ftesën nga lidhja e dërguar (“Kam një ftesë”), pastaj regjistroni kompaninë.', 'signup err: email_invited (pending-invite placeholder)');
  await tryErr(json(423, { error: 'locked', message: 'x', retryAfter: 27 }), 'Shumë tentime — provoni pas 27 s.', 'signup err: locked');
  // blank NUI / city travel as "" (literal contract shape), the typed values are restored afterwards
  a.setL({ sgNui: '', sgCity: '' }); await tryErr(json(409, { error: 'duplicate_name', message: 'x' }), 'Ekziston një kompani me këtë emër.', 'signup: blank NUI/city still post');
  eq(sg.bodies[sg.bodies.length - 1].body.company, { name: 'Firma e Re SH.P.K.', nui: '', city: '' }, 'signup: blank NUI/city are sent as "" (contract body shape)');
  a.setL({ sgNui: '811223344', sgCity: 'Prishtinë' });
  await tryErr(json(403, { error: 'signup_disabled', message: 'x' }), 'Regjistrimi i kompanive të reja është i mbyllur momentalisht — kontaktoni Kontabo.', 'signup err: signup_disabled');
  await tryErr(json(429, { error: 'too_many_requests', message: 'x', retryAfter: 900 }), 'Shumë regjistrime nga ky rrjet — provoni pas 15 min.', 'signup err: too_many_requests');
  await tryErr(json(400, { error: 'weak_password', message: 'Fjalëkalimi duhet të ketë së paku 8 karaktere' }), 'Fjalëkalimi duhet të ketë së paku 8 karaktere', 'signup err: weak_password → server message');
  await tryErr(json(400, { error: 'validation_error', message: 'NUI duhet të ketë 6–12 shifra' }), 'NUI duhet të ketë 6–12 shifra', 'signup err: validation_error → server message');
  { const fetchSg = ctx.fetch; ctx.fetch = async (url, o = {}) => { if (url.endsWith('/auth/signup')) throw new TypeError('Failed to fetch'); return fetchSg(url, o); }; a.renderVals().lDoSignup(); for (let i = 0; i < 30 && a.state.login.busy; i++) await wait(); eq(a.state.login.err, 'Serveri nuk u arrit: Failed to fetch', 'signup err: network'); ctx.fetch = fetchSg; }
  eq(a.renderVals().lSgPw, 'Sekret123', 'signup: the typed password is kept after a failed attempt');
  // success: exact contract body, session from the response, dashboard of the new EMPTY company
  sg.reply = null; const callsBefore = srv.calls.length; a.renderVals().lDoSignup(); for (let i = 0; i < 60 && (!a.state.session || !a.state.session.userId || !a.state.db || a.state.db.company.name !== 'Firma e Re SH.P.K.'); i++) await wait();
  const sb = sg.bodies[sg.bodies.length - 1];
  eq([srv.calls.slice(callsBefore).includes('POST /auth/signup'), sb.auth, sb.body], [true, null, { company: { name: 'Firma e Re SH.P.K.', nui: '811223344', city: 'Prishtinë' }, name: 'Blerta Gashi', email: 'blerta@firma-re.com', password: 'Sekret123', remember: true }], 'signup: POST /auth/signup without bearer, exact contract body (email lowercased)');
  eq([!!a.state.session, a.state.session.name, a.state.session.role, a.state.session.userId, a.state.session.api, a.apiCfg().tenantId, a.apiCfg().tenantName, a.apiCfg().accessToken, a.apiCfg().tenants.length], [true, 'Blerta Gashi', 'Pronar', 'm9', true, 't9', 'Firma e Re SH.P.K.', 'acc-9', 1], 'signup: session + active tenant from the response');
  eq([a.state.admin, a.state.section, a.state.page, a.state.login.view, a.state.login.busy, a.state.login.err, a.state.login.sgPw, a.state.login.sgPw2], [false, 'dashboard', 'Paneli', 'login', false, '', '', ''], 'signup: lands on Paneli, login view reset, passwords cleared');
  { const L = a.state.login; eq([L.sgCompany, L.sgNui, L.sgCity, L.sgName, L.sgEmail], ['', '', '', '', ''], 'signup: the whole form is emptied after success (a second company never inherits the old NUI/city)'); }
  { const v = a.renderVals(); eq([a.apiCfg().tenantPlan, !!a.apiCfg().trialEndsAt, v.isTrial, v.trialDays, v.trialPct], ['trial', true, true, 14, '100%'], 'signup: trial banner counts from the server tenant (createdAt + trialEndsAt → 14 days left of 14)'); }
  { const cfg = a.apiCfg(); const keep = { tenantSince: cfg.tenantSince, trialEndsAt: cfg.trialEndsAt }; a.saveApi({ tenantSince: new RealDate(clockNow() - 10 * 86400000).toISOString(), trialEndsAt: new RealDate(clockNow() + 4 * 86400000 - 3600000).toISOString() }); eq([a.renderVals().trialDays, a.renderVals().trialPct], [4, '29%'], 'trial banner: 10 days into a 14-day trial → 4 left');
    a.saveApi({ trialEndsAt: new RealDate(clockNow() - 3 * 86400000).toISOString() }); eq(a.renderVals().trialDays, 0, 'trial banner: an ended trial shows 0, never negative'); a.saveApi(keep); }
  eq([srv.calls.slice(callsBefore).includes('GET /state'), srv.calls.slice(callsBefore).includes('PUT /state'), sg.version, sg.state.invoices.length, sg.state.customers.length, sg.state.products.length, sg.state.company.name, sg.state.company.nui, sg.state.company.city, sg.state.users, a._signupSeed], [true, true, 1, 0, 0, 0, 'Firma e Re SH.P.K.', '811223344', 'Prishtinë', undefined, null], 'signup: first load → /state empty → seeded empty books on the server (no demo), company card from the form');
  eq([a.state.db.invoices.length, a.state.db.customers.length, a.state.db.company.name, a.state.db.users.length, a.state.db.users[0].email, a.state.db.fiscal, /Mirë se erdhe, Blerta/.test(a.state.toast || '') && /Firma e Re SH.P.K./.test(a.state.toast || '')], [0, 0, 'Firma e Re SH.P.K.', 1, 'blerta@firma-re.com', undefined, true], 'signup: empty books + server mirrors (no fiscal mirror), greeting names the new company');
  a.setL({ sgCompany: 'Tjetra', sgNui: '812345678', sgCity: 'Gjakovë' }); a.logout(); await wait(); eq([a.state.session, a.apiAuthed(), a.state.login.sgCompany, a.state.login.sgNui, a.state.login.sgCity], [null, false, '', '', ''], 'signup: logout after signup also empties the signup form');
  ctx.fetch = loginAdmin;
  clearTimeout(a._retryT);
})().catch(e => { console.log('FAIL api-mode tests threw: ' + (e && e.stack || e)); process.exitCode = 1; });

// ── demo data removed: derived statuses, editable accounts, terminals, empty tenant books ──
c.state.db = c.seedDb(); c.state.session = null; c.state.dr = null; c.state.frm = null; c.state.admin = false; c.state.section = 'settings'; c.state.page = 'Fiskalizimi';
{ const v = c.renderVals();
  eq([v.fiscalTerms.length, v.fiscalHasTerms], [0, false], 'fiscal monitor: no invented terminals (empty state until tills report)');
  eq(v.queueStats.find(x => x.label === 'Të suksesshme').n, db().queue.filter(q => q.status === 'E suksesshme').length, 'queue: successful count is counted, not 1284');
  eq(v.fiscalTabs.map(t => t.label), ['Arkat', 'Radha e transaksioneve', 'Kuponët'], 'fiscal page: read-only tabs (arkat / queue / receipts)');
  eq(v.fiscalGuide.length >= 4 && v.fiscalGuide.every(g => !g.go), true, 'fiscal guide: plain text steps, nothing clickable/configurable');
  eq(v.fiscalUrls.map(u => u.id), ['TEST', 'PROD'], 'fiscal: ATK service URLs shown read-only');
  eq(v.taxGroups.map(t => t.code + t.rate).join(' '), 'A0% C0% D8% E18%', 'fiscal page: ATK tax groups listed'); }
// a locally connected POS (no registered terminal) appears in the monitor with the fiscal state IT reports
c.state.db = { ...db(), posSync: { ...db().posSync, status: 'online', health: { pos_id: 'POS-0009', pos_name: 'Arka lokale', branch: 'Dega Prishtinë', version: '0.7.1', pending_sync: 2, fiscal: { mode: 'ATK_ELECTRONIC', env: 'TEST', version: 5, simulator: true, pending: 3 } } } };
{ const t = c.renderVals().fiscalTerms; eq([t.length, t[0].name, t[0].mode, t[0].env, t[0].ver, t[0].simOn, t[0].pending, t[0].link], [1, 'Arka lokale', 'ATK_ELECTRONIC', 'TEST', 'v5', true, '3', 'Online (lokale)'], 'fiscal monitor: the local till\'s reported mode/env/version/simulator/pending'); }
c.state.db = { ...db(), posSync: { ...db().posSync, status: 'unknown', health: null } };
{ const v = c.renderVals(); v.queue[0].details(); eq(c.state.dr && c.state.dr.kind, 'queue', 'queue: Detajet opens a drawer'); eq(!!c.drawerVals() && c.drawerVals().title === db().queue[0].ref, true, 'queue drawer renders'); c.state.dr = null; }
// accounts are data
eq(c.ACCOUNTS.length, 3, 'accounts: seed has three'); c.openForm('account', { name: 'Raiffeisen', type: 'Bankë', detail: 'XK00', opening: '500' }); c.formVals().actions[0].go();
eq([c.ACCOUNTS.length, c.accountBalance(c.ACCOUNTS[3].id), c.ACCOUNTS[3].opening_c], [4, 50000, 50000], 'accounts: added with opening balance');
c.openForm('account', { edit: c.ACCOUNTS[3].id, name: 'Raiffeisen Bank', type: 'Bankë', detail: 'XK00', opening: '600' }); c.formVals().actions.find(a => a.label === 'Ruaj').go(); eq([c.ACCOUNTS[3].name, c.accountBalance(c.ACCOUNTS[3].id)], ['Raiffeisen Bank', 60000], 'accounts: edited');
c.recordPayment({ kind: 'sale', ref: 'FSH-2026-00125', amount_c: 1000, account: c.ACCOUNTS[3].id, date: '13.09.2026', note: '' }); eq(c.accountBalance(c.ACCOUNTS[3].id), 61000, 'accounts: payments hit the new account'); { const J = c.journal(); eq(J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with a fourth account'); }
{ const t = c.pageTable('Llogari bankare'); eq(t.actions[0].label, '+ Llogari', 'bank page: add action'); }
// terminals (local)
c.openForm('terminal', { name: 'Arka 5', posId: 'pos-0005', branch: 'Dega Prishtinë', warehouse: 'W1' }); eq(c.formVals().actions[0].disabled, false, 'terminal form ready'); c.formVals().actions[0].go();
eq([db().terminals.length, db().terminals[0].posId, c.ACCOUNTS.some(a => a.type === 'Arkë' && a.detail === 'POS-0005')], [1, 'POS-0005', true], 'terminal: registered locally + a cash account for it');
c.state.section = 'pos'; c.state.page = 'Arkat'; { const t = c.pageTable('P:Arkat'); eq(t.rows.length, 1, 'Arkat page lists registered terminals only'); }
c.state.page = 'Fiskalizimi'; c.state.section = 'settings'; { const v = c.renderVals(); eq([v.fiscalTerms.length, v.fiscalTerms[0].name, v.fiscalTerms[0].mode], [1, 'Arka 5', '—'], 'fiscal monitor: registered terminal listed; mode "—" until the till reports it'); }
c.importPosSales([rcpt('r-t5', 'POS-0005/000001', 'final', 'fiscalized_sim', [it('LED-18', 'LED', 1000, 890)], 1050, 0, { pos_id: 'POS-0005' })], []);
eq([db().posReceipts[0].posName, db().payments[0].account === c.ACCOUNTS.find(a => a.detail === 'POS-0005').id], ['Arka 5', true], 'POS receipt lands in the terminal\'s own cash account');
// Kompanitë e mia: only real companies
c.state.section = 'kompania'; c.state.page = 'Kompanitë e mia'; { const v = c.renderVals(); eq([v.firms.length, v.firms[0].name, v.firmCount], [1, db().company.name, 1], 'kompanitë e mia: no invented tenants in local mode'); }
// empty tenant books
{ const e = c.seedEmpty({ name: 'Firma X', nui: '810000000', city: 'Pejë', plan: 'pro' }); eq([e.invoices.length, e.products.length, e.customers.length, e.queue.length, e.company.name, e.company.nui, e.accounts.length, e.warehouses.length, e.terminals.length, e.admin.tenants.length, e.subscription.plan, e.users, e.fiscal], [0, 0, 0, 0, 'Firma X', '810000000', 2, 1, 0, 0, 'pro', undefined, undefined], 'seedEmpty: nothing demo, server-owned keys absent');
  c.state.db = { ...e, ...c.apiSessionExtras({ name: 'X', email: 'x@y', role: 'Pronar' }), users: [], roles: {}, audit: [] };
  c.state.section = 'dashboard'; c.state.page = 'Paneli'; const v = c.renderVals(); eq([v.kpis.length, v.alerts.some(a => /abonimit/.test(a.t))], [8, false], 'empty books render and no subscription alert without a billing date');
  for (const pg of ['Blerje', 'Gjendja', 'Bilanci', 'TVSH', 'R:Shitje', 'P:Arkat', 'Integrimet', 'POS', 'Siguria']) { c.state.rTab = ''; const t = c.pageTable(pg) || c.settingsPage(pg); eq(!!t, true, 'empty books: page renders ' + pg); }
  for (const [sec, pg] of [['shitje', 'Fatura'], ['shitje', 'Klientë'], ['produkte', 'Produktet']]) { c.state.section = sec; c.state.page = pg; const v = c.renderVals(); eq(v.invoices.length + v.customers.length + v.products.length, 0, 'empty books: ' + pg + ' renders empty'); } }

// ── categories: a managed list (db.categories) + product form net ⇄ gross price pairs ──
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null;
{ const d0 = db();
  eq(d0.categories.map(x => x.name), ['Ndërtim', 'Dysheme', 'Materiale', 'Bojëra', 'Elektrike'], 'categories: seed list = the distinct product categories, in first-seen order');
  eq(d0.categories.map(x => x.id), ['K-ndertim', 'K-dysheme', 'K-materiale', 'K-bojera', 'K-elektrike'], 'categories: deterministic slug ids (diacritics folded)');
  eq(c.migrateCats(d0) === d0, true, 'categories migration: nothing missing → the SAME object (idempotent)');
  const old = { ...d0 }; delete old.categories; const m1 = c.migrateCats(old), m2 = c.migrateCats(m1);
  eq([m1.categories.length, m2 === m1, m1.categories.map(x => x.id).join()], [5, true, d0.categories.map(x => x.id).join()], 'categories migration: old books (no list) get the list once; a second pass is a no-op');
  const stray = c.migrateCats({ ...d0, products: [...d0.products, { sku: 'ZZ', cat: 'Hidraulikë' }, { sku: 'ZY', cat: 'hidraulikë ' }] });
  eq([stray.categories.length, stray.categories[5].name, stray.categories[5].id], [6, 'Hidraulikë', 'K-hidraulike'], 'categories migration: a product with an unknown category appends ONE record (case/space-insensitive)');
  eq(c.migrateCats({ ...d0, categories: [{ id: 'K-x', name: 'X' }] }).categories.length, 6, 'categories migration: keeps records no product uses');
  eq(c.newCategory('Ndërtim', d0.categories).id, 'K-ndertim-2', 'newCategory: id collision gets a numeric suffix');
  eq(['Ndërtim', 'Dysheme', 'Materiale', 'Bojëra', 'Elektrike'].map(n => c.catUsage(c.findCategory(d0.categories, n).id)), [3, 2, 1, 1, 2], 'categories: product counts per category');
  eq(c.seedEmpty({ name: 'F' }).categories, [], 'seedEmpty: empty category list (server tenants start with none)');
}
// add / duplicate / rename propagation / delete guard — through the form
c.openForm('category'); eq([c.formVals().title, c.formVals().actions[0].disabled], ['Kategori e re', true], 'category form: blocked until a name is typed');
c.setF({ name: 'ndërtim' }); eq([c.formVals().actions[0].disabled, c.formVals().fields[0].hint], [true, 'ekziston tashmë'], 'category form: duplicate (case-insensitive) flagged, save disabled');
c.setF({ name: 'Hidraulikë', note: 'tuba, rubineta' }); c.formVals().actions[0].go();
eq([db().categories.length, db().categories[5].name, db().categories[5].note, c.state.frm], [6, 'Hidraulikë', 'tuba, rubineta', null], 'category form: added with note, form closed');
eq(c.addCategory('HIDRAULIKË'), null, 'addCategory: duplicate refused');
{ const id = c.findCategory(db().categories, 'Elektrike').id;
  c.openForm('category', { edit: id, name: 'Elektrike', note: '' }); let v = c.formVals();
  eq([v.title, v.actions[0].label, v.actions[0].disabled, v.fields[2].value, !!v.msg], ['Redakto kategorinë', 'Fshi', true, '2 produkte', true], 'category edit: delete disabled while 2 products use it (hint shown)');
  c.setF({ name: 'Elektrikë & ndriçim' }); c.formVals().actions.find(a => a.label === 'Ruaj').go();
  eq([db().categories.find(x => x.id === id).name, db().products.filter(p => p.cat === 'Elektrikë & ndriçim').map(p => p.sku).sort(), db().products.some(p => p.cat === 'Elektrike')], ['Elektrikë & ndriçim', ['KB-325', 'LED-18'], false], 'category rename: propagates to every product, old name gone');
  eq(c.renameCategory(id, 'Dysheme'), false, 'category rename: refused when the new name belongs to another category');
  eq(c.deleteCategory(id), false, 'deleteCategory: guarded while products use it');
  eq(db().categories.length, 6, 'deleteCategory: nothing removed');
  const hid = c.findCategory(db().categories, 'Hidraulikë').id;
  c.openForm('category', { edit: hid, name: 'Hidraulikë', note: '' }); v = c.formVals(); eq([v.actions[0].label, v.actions[0].disabled, v.fields[2].value], ['Fshi', false, 'asnjë'], 'category edit: delete enabled when unused');
  v.actions[0].go(); c.state.confirm.ok();
  eq([db().categories.length, db().categories.some(x => x.id === hid), c.state.frm], [5, false, null], 'category delete: unused category removed, form closed');
}
// Kategoritë page (route #kategorite)
ctx.location = { hash: '#kategorite' }; c.routeHash();
eq([c.state.section, c.state.page], ['produkte', 'Kategoritë'], 'route: #kategorite → Produkte › Kategoritë');
{ const v = c.renderVals(); eq([v.isTable, v.tbl.title, v.tbl.count, v.tbl.actions[0].label, v.tbl.rows.length], [true, 'Kategoritë', '5', '+ Kategori', 5], 'Kategoritë page: renders the managed list with + Kategori');
  const row = v.tbl.rows.find(r => r.cells[0].t === 'Ndërtim'); eq([row.cells[1].t, row.cells[5].t, row.cells[5].act], ['3', 'Redakto', true], 'Kategoritë page: product count + Redakto action per row');
  row.cells[5].go(); eq([c.state.frm.kind, c.state.frm.edit, c.state.frm.name], ['category', 'K-ndertim', 'Ndërtim'], 'Kategoritë page: Redakto opens the edit form'); c.state.frm = null;
  row.open(); eq([c.state.page, c.state.pFilter, c.renderVals().products.every(p => p.catName === 'Ndërtim')], ['Produktet', 'Ndërtim', true], 'Kategoritë page: row click filters Produktet by that category'); c.state.pFilter = 'Të gjitha'; }
// product form: net ⇄ gross pairs (gross = round(net × (100+rate)/100); net = round(gross × 100/(100+rate)); net is the stored truth)
const fld = k => c.formVals().fields.find(f => f.key === k), typeF = (k, v) => fld(k).set({ target: { value: v } });
c.openForm('product'); { const labels = c.formVals().fields.map(f => f.label);
  eq(labels.filter(l => /TVSH \(€\)/.test(l)), ['Kosto e blerjes pa TVSH (€)', 'Kosto e blerjes me TVSH (€)', 'Çmimi i shitjes pa TVSH (€)', 'Çmimi i shitjes me TVSH (€)'], 'product form: two net/gross pairs');
  eq(fld('cat').opts.map(o => o.label), db().categories.map(x => x.name), 'product form: Kategoria combo lists db.categories'); }
// (4-decimal build) the pairs are exact to the 4th decimal: a derived side shows 4 decimals only when it carries sub-cent precision
c.setF({ tax: 'E' }); typeF('priceG', '2.20'); eq(c.state.frm.price, '1.8644', 'gross 2.20 @18% → net 1.8644 (exact, 4 decimals)');
typeF('price', '1.8644'); eq(c.state.frm.priceG, '2.20', 'net 1.8644 @18% → gross 2.20 (round-trips, shown with 2 decimals)');
typeF('price', '1.86'); eq(c.state.frm.priceG, '2.1948', 'net 1.86 @18% → gross 2.1948');
typeF('priceG', '2.1948'); eq(c.state.frm.price, '1.86', 'gross 2.1948 @18% → net 1.86 (stable)');
typeF('price', '18.50'); eq(c.state.frm.priceG, '21.83', 'net 18.50 @18% → gross 21.83');
typeF('costG', '13.22'); eq(c.state.frm.cost, '11.2034', 'cost gross 13.22 @18% → net 11.2034');
typeF('cost', '11.20'); eq(c.state.frm.costG, '13.2160', 'cost net 11.20 @18% → gross 13.2160 (4 decimals whenever the value is not whole cents)');
fld('tax').opts.find(o => o.label.startsWith('D')).go(); eq([c.state.frm.tax, c.state.frm.price, c.state.frm.priceG, c.state.frm.cost, c.state.frm.costG], ['D', '18.50', '19.98', '11.20', '12.0960'], 'tax letter → D 8%: gross sides re-derived from the stored net (net untouched)');
typeF('priceG', '10.00'); eq(c.state.frm.price, '9.2593', 'gross 10.00 @8% → net 9.2593');
typeF('price', '9.26'); eq(c.state.frm.priceG, '10.0008', 'net 9.26 @8% → gross 10.0008');
{ const before = [c.state.frm.price, c.state.frm.cost]; for (let i = 0; i < 6; i++) fld('tax').opts.find(o => o.label.startsWith(i % 2 ? 'D' : 'E')).go();
  eq([c.state.frm.tax, c.state.frm.price, c.state.frm.cost, c.state.frm.priceG, c.state.frm.costG], ['D', before[0], before[1], '10.0008', '12.0960'], 'toggling the tax letter repeatedly never drifts (gross always = f(net))'); }
typeF('priceG', 'abc'); eq([fld('priceG').err, c.state.frm.price, c.formVals().actions[0].disabled], ['1', '', true], 'unparsable gross → err flag, net cleared, save blocked');
typeF('price', '1.999'); eq([fld('price').err, c.state.frm.priceG], ['', '2.1589'], 'net with 3 decimals is valid now (4-decimal prices; letter D → 1.999 × 1.08)');
typeF('price', '1.99999'); eq([fld('price').err, c.state.frm.priceG], ['1', ''], 'unparsable net (5 decimals) → err flag, gross cleared');
c.setF({ name: 'Tub PVC 50mm', sku: 'tb-050', cat: 'Hidraulikë', catQ: 'Hidraulikë', unit: 'm', tax: 'E', opening: '0', minStock: '10' }); typeF('costG', '1.18'); typeF('priceG', '2.20');
eq([fld('cat').hint, c.formVals().actions[0].disabled], ['e re — krijohet me ruajtjen', false], 'product form: a typed new category is announced, form ready');
c.formVals().actions[0].go();
{ const p = db().products.find(x => x.sku === 'TB-050'); eq([p.price_c, p.cost_c, p.price_t, p.cost_t, p.cat, db().categories.some(x => x.name === 'Hidraulikë')], [186, 100, 18644, 10000, 'Hidraulikë', true], 'stored price_c/cost_c are NET cents (rounded) next to the exact price_t/cost_t ten-thousandths; the new category was created on save');
  const cp = c.posCatalogPayload().products.find(x => x.sku === 'TB-050'); eq([cp.price_c, cp.price_t], [186, 18644], 'catalog payload: product price stays net cents (POS contract unchanged) + price_t with 4 decimals'); }
{ const cat = c.posCatalogPayload(); eq([Array.isArray(cat.categories), cat.categories.length, cat.categories[0], cat.products.every(p => typeof p.cat === 'string')], [true, 6, { id: 'K-ndertim', name: 'Ndërtim' }, true], 'catalog payload: carries the categories list + per-product cat'); }
// edit form from the drawer: prices shown both ways, saved as net
c.openProduct('PS-050'); { const d = c.drawerVals(); eq([d.actions[0].label, d.meta.find(m => m.k === 'Çmimi i shitjes (pa TVSH)').v, d.meta.find(m => m.k.startsWith('Çmimi me TVSH')).v], ['Redakto', '€18.50', '€21.83'], 'product drawer: Redakto + net and gross sale price');
  d.actions[0].go(); const v = c.formVals(); eq([v.title, c.state.frm.price, c.state.frm.priceG, c.state.frm.cost, c.state.frm.costG, fld('sku').dis, v.fields.some(f => f.key === 'opening')], ['Redakto produktin', '18.50', '21.83', '11.20', '13.2160', true, false], 'product edit form: pre-filled both sides (a seed product without price_t is read as cents × 100), sku locked, no opening stock field');
  typeF('priceG', '23.60'); fld('cat').set({ target: { value: 'Dysheme' } }); c.setF({ minStock: '120' }); c.formVals().actions[0].go();
  const p = db().products.find(x => x.sku === 'PS-050'); eq([p.price_c, p.cost_c, p.cat, p.minStock, c.state.frm, c.state.dr && c.state.dr.id], [2000, 1120, 'Dysheme', 120000, null, 'PS-050'], 'product edit: gross 23.60 saved as net 20.00, category/minStock updated, drawer reopened');
  eq(c.renderVals().products.find(x => x.sku === 'PS-050').priceGross, '€23.60', 'product list: shows the gross sale price next to the net one'); }
// a case/space variant of an existing category is stored with the managed record's spelling (no split rows in filters/reports)
{ const n0 = db().categories.length, u0 = c.catUsage('K-ndertim'); c.addProduct({ name: 'Çimento 25kg', sku: 'CM-025', barcode: '—', cat: 'ndërtim ', unit: 'thes', tax: 'E', price_c: 500, cost_c: 400, openCost_c: 400, opening: 0, minStock: 0 });
  eq([db().products.find(x => x.sku === 'CM-025').cat, db().categories.length, c.catUsage('K-ndertim')], ['Ndërtim', n0, u0 + 1], 'addProduct: typed “ndërtim ” stored as the record name “Ndërtim”, no new record, counted');
  c.updateProduct('CM-025', { cat: 'DYSHEME' }); eq(db().products.find(x => x.sku === 'CM-025').cat, 'Dysheme', 'updateProduct: category variant canonicalised too');
  c.updateProduct('CM-025', { minStock: 5000 }); eq([db().products.find(x => x.sku === 'CM-025').cat, db().products.find(x => x.sku === 'CM-025').minStock], ['Dysheme', 5000], 'updateProduct: a patch without cat leaves the category alone');
  c.updateProduct('CM-025', { cat: 'Izolim' }); eq([db().products.find(x => x.sku === 'CM-025').cat, db().categories.length, db().categories[db().categories.length - 1].name], ['Izolim', n0 + 1, 'Izolim'], 'updateProduct: an unknown name is still created as a new record (free option kept)');
  c.openProduct('CM-025'); c.drawerVals().actions[0].go(); fld('cat').set({ target: { value: 'ndërtim' } }); c.formVals().actions[0].go();
  eq([db().products.find(x => x.sku === 'CM-025').cat, db().categories.length], ['Ndërtim', n0 + 1], 'product edit form: typed variant saved canonical');
  c.state.section = 'raporte'; c.state.page = 'Stok'; c.state.rTab = 'Gjendja sipas kategorisë'; c.state.rp = 'all'; const t = c.pageTable('R:Stok'); const nd = t.rows.filter(r => c.norm(r.cells[0].t) === 'ndertim');
  eq([nd.length, nd[0].cells[1].t, [...new Set(db().products.map(x => x.cat))].filter(x => c.norm(x) === 'ndertim').length], [1, String(u0 + 1), 1], 'Raporte › Stok › Gjendja sipas kategorisë: ONE Ndërtim row with the variant product counted'); c.state.rTab = '';
  c.state.section = 'produkte'; c.state.page = 'Produktet'; const opts = c.renderVals().pFilterOpts.map(o => o.id).filter(x => c.norm(x) === 'ndertim'); eq(opts, ['Ndërtim'], 'Produktet category filter: a single Ndërtim entry');
  c.state.db = { ...db(), products: db().products.filter(x => x.sku !== 'CM-025'), categories: db().categories.filter(x => x.name !== 'Izolim') }; }

// ══ ATK SEF test agenda (application 70754265): 4-decimal prices/quantities, value discounts, cancel reasons, tax-block receipts, non-VAT mode ══
c.state.db = c.seedDb();
// ── ten-thousandths helpers
eq([c.toT('12.3456'), c.toT('12,34'), c.toT('7'), c.toT('0.0001'), c.toT('1.23456'), c.toT('abc'), c.toT('')], [123456, 123400, 70000, 1, null, null, null], 'toT: up to 4 decimals → ten-thousandths, 5 decimals / text / empty rejected');
eq([c.fromT(123456), c.fromT(123400), c.fromT(70000), c.fmtT(123456), c.fmtT(185000), c.fmtT(-1234567)], ['12.3456', '12.34', '7.00', '€12.3456', '€18.50', '-€123.4567'], 'fromT/fmtT: 2 decimals unless sub-cent precision exists');
eq([c.cOfT(123456), c.cOfT(123450), c.cOfT(123449), c.grossOfT(18644, 18), c.netOfT(22000, 18)], [1235, 1235, 1234, 22000, 18644], 'cOfT rounds to cents; grossOfT/netOfT are exact to the 4th decimal');
eq([c.priceT({ price_c: 1850 }), c.priceT({ price_c: 1850, price_t: 18501 }), c.costT({ cost_c: 100 })], [185000, 18501, 10000], 'priceT/costT: stored ten-thousandths win, else cents × 100 (older books)');
// ── product with a 4-decimal price through the form → stored both ways, listed with 4 decimals, catalog carries price_t
c.openForm('product'); c.setF({ name: 'Vidë 3.5×25', sku: 'VD-3525', cat: 'Ndërtim', catQ: 'Ndërtim', unit: 'copë', tax: 'E', opening: '1000', minStock: '0' }); typeF('cost', '0.0123'); typeF('price', '0.0275');
eq([c.state.frm.priceG, c.state.frm.costG, fld('price').hint, c.formVals().actions[0].disabled], ['0.0325', '0.0145', 'deri në 4 numra pas presjes', false], 'product form: 4-decimal net prices → gross exact to the 4th decimal (0.0275 × 1.18 = 0.03245 → 0.0325)');
c.formVals().actions[0].go();
{ const p = db().products.find(x => x.sku === 'VD-3525'); eq([p.price_t, p.price_c, p.cost_t, p.cost_c, p.openCost_c], [275, 3, 123, 1, 1], 'product saved: price_t/cost_t exact, price_c/cost_c = rounded cents (0.0275 → 0.03, 0.0123 → 0.01)');
  c.state.section = 'produkte'; c.state.page = 'Produktet'; const row = c.renderVals().products.find(x => x.sku === 'VD-3525'); eq([row.price, row.priceGross], ['€0.0275', '€0.0325'], 'product list: shows the 4-decimal price when the precision exists');
  eq(c.renderVals().products.find(x => x.sku === 'PS-050').price, '€18.50', 'product list: whole-cent prices keep 2 decimals');
  c.openProduct('VD-3525'); const d = c.drawerVals(); eq([d.meta.find(m => m.k === 'Çmimi i shitjes (pa TVSH)').v, d.meta.find(m => m.k.startsWith('Çmimi me TVSH')).v], ['€0.0275', '€0.0325'], 'product drawer: 4-decimal net + gross');
  d.actions[0].go(); eq([c.state.frm.price, c.state.frm.priceG, c.state.frm.cost], ['0.0275', '0.0325', '0.0123'], 'product edit form: pre-filled from price_t/cost_t (no cent rounding)'); c.state.frm = null; c.state.dr = null;
  const cp = c.posCatalogPayload().products.find(x => x.sku === 'VD-3525'); eq([cp.price_c, cp.price_t, cp.tax, cp.rate], [3, 275, 'E', 18], 'catalog payload: price_c (cents) + price_t (ten-thousandths) per product');
  eq(c.posCatalogPayload().products.every(x => Number.isInteger(x.price_t) && x.price_t >= 0), true, 'catalog payload: every product ships an integer price_t');
  c.state.section = 'produkte'; c.state.page = 'Çmimet'; const t = c.pageTable('Çmimet'); const r = t.rows.find(x => x.cells[1].t === 'VD-3525'); eq([r.cells[4].t, r.cells[7].t], ['€0.0275', '€0.0325'], 'Lista e çmimeve: 4-decimal net and gross'); }
// ── the GROSS price VERBATIM (Annex F p79 "3 X 1.5068" @ 18 % is unreachable from a net ten-thousandth): the product form keeps the gross
// side as typed (gross_t), lists / drawer / catalog print it, a stale gross (after a tax change) falls back to the derived one
c.openForm('product'); c.setF({ name: 'Coca Cola 0.5', sku: 'CC-05', cat: 'Ndërtim', catQ: 'Ndërtim', unit: 'copë', tax: 'E', opening: '0', minStock: '0' }); typeF('cost', '1.00'); typeF('priceG', '1.5068');
eq([c.state.frm.price, c.state.frm.priceG, c.grossOfT(c.toT(c.state.frm.price), 18)], ['1.2769', '1.5068', 15067], 'product form: gross 1.5068 typed → net 1.2769 (derived gross would print 1.5067 — one ten-thousandth off)');
c.formVals().actions[0].go();
{ const p = db().products.find(x => x.sku === 'CC-05'); eq([p.price_t, p.gross_t, c.grossT(p), c.fmtT(c.grossT(p))], [12769, 15068, 15068, '€1.5068'], 'product saved: price_t 12769 (net) + gross_t 15068 VERBATIM; grossT() prints 1.5068, not the derived 1.5067');
  c.state.section = 'produkte'; c.state.page = 'Produktet'; eq(c.renderVals().products.find(x => x.sku === 'CC-05').priceGross, '€1.5068', 'product list: the gross column shows the verbatim 1.5068');
  c.openProduct('CC-05'); const d = c.drawerVals(); eq(d.meta.find(m => m.k.startsWith('Çmimi me TVSH')).v, '€1.5068', 'product drawer: gross 1.5068 verbatim');
  d.actions[0].go(); eq([c.state.frm.price, c.state.frm.priceG], ['1.2769', '1.5068'], 'product edit form: pre-filled with the verbatim gross'); c.state.frm = null; c.state.dr = null;
  const cp = c.posCatalogPayload().products.find(x => x.sku === 'CC-05'); eq([cp.price_t, cp.gross_t, cp.rate], [12769, 15068, 18], 'catalog payload: gross_t 15068 next to price_t — the till prints and computes 3 × 1.5068 = 4.52 from it');
  eq(c.posCatalogPayload().products.every(x => Number.isInteger(x.gross_t) && x.gross_t > 0), true, 'catalog payload: every product ships gross_t (derived when none was typed)');
  eq(c.posCatalogPayload().products.find(x => x.sku === 'PS-050').gross_t, c.grossOfT(c.priceT(db().products.find(x => x.sku === 'PS-050')), 18), 'catalog payload: a product without a typed gross ships the derived one (18.50 → 21.83)');
  c.updateProduct('CC-05', { tax: 'D' }); const p2 = db().products.find(x => x.sku === 'CC-05'); eq([p2.gross_t, c.grossT(p2), c.grossOfT(12769, 8)], [15068, 13791, 13791], 'a gross kept from before a tax change (18 % → 8 %) is more than a cent off → ignored, the gross is derived again');
  c.updateProduct('CC-05', { tax: 'E' }); }
// ── the operator's identification number (Kërkesat SEF neni 25.18): user drawer › "Nr. identifikues për kupon…" → catalog operators[].code
{ c.openDr('user', 'u3'); let d = c.drawerVals(); eq([d.actions.some(a => a.label === 'Nr. identifikues për kupon…'), d.meta.find(m => m.k === 'Nr. identifikues (kupon)').v], [true, '—'], 'user drawer (POS role): the "Nr. identifikues për kupon…" action, meta "—" while none');
  eq(c.posCatalogPayload().operators.find(o => o.name === 'Fjolla Kastrati').code, '', 'catalog operators: code empty while none is set (the coupon prints only the name, Annex F)');
  d.actions.find(a => a.label === 'Nr. identifikues për kupon…').go(); typeF('code', '12 34'); eq([!!fld('code').err, c.formVals().actions[0].disabled], [true, true], 'opcode form: a code with a space is refused');
  typeF('code', ' 1234 '); eq([!!fld('code').err, c.formVals().fields.find(f => f.label === 'Në kupon').value], [false, 'EMRI I PUNËTORIT: FJOLLA KASTRATI (ID 1234)'], 'opcode form: the preview line reads EMRI I PUNËTORIT: FJOLLA KASTRATI (ID 1234)');
  c.formVals().actions[0].go(); eq([db().users.find(u => u.id === 'u3').opCode, c.posCatalogPayload().operators.find(o => o.name === 'Fjolla Kastrati').code], ['1234', '1234'], 'saved (trimmed): users[].opCode → catalog operators[].code 1234');
  c.openDr('user', 'u3'); d = c.drawerVals(); eq(d.meta.find(m => m.k === 'Nr. identifikues (kupon)').v, '1234', 'user drawer shows the code');
  c.openDr('user', 'u6'); eq(c.drawerVals().actions.some(a => a.label === 'Nr. identifikues për kupon…'), false, 'a non-POS user (Kontabilist) has no coupon code action'); c.state.dr = null; }
// ── importPosSales keeps a line's verbatim gross_t
{ const gi = { sku: 'LED-18', name: 'Ndriçues LED 18W', unit: 'copë', qty_m: 3000, qty_q: 30000, unit_c: 128, unit_t: 12769, gross_t: 15068, rate: 18, disc_bp: 0, sub_c: 383, vat_c: 69, tot_c: 452, tax: 'E' };
  const RG = rcpt('r-g', 'POS-0001/000090', 'final', 'fiscalized', [gi], 452, 0);
  c.importPosSales([RG], []); const doc = db().posReceipts.find(r => r.id === 'r-g'); eq([doc.items[0].gross_t, doc.items[0].unit_t, doc.total], [15068, 12769, 452], 'pos import: the line keeps gross_t 15068 next to unit_t (the coupon printed 3 × 1.5068 = 4.52)'); }
// ── Cilësime › POS: fiscal block code → catalog posSettings.fiscalBlockCode
{ const g = c.settingsPage('POS'); const f = g.cards.flatMap(x => x.fields).find(x => x.label === 'Kodi i bllokut tatimor (ATK)'); eq(!!f, true, 'Cilësime › POS: field "Kodi i bllokut tatimor (ATK)"');
  eq(c.posCatalogPayload().posSettings.fiscalBlockCode, '', 'catalog: fiscalBlockCode empty by default');
  f.set({ target: { value: ' BT-2026-017 ' } }); eq([db().posSettings.fiscalBlockCode, c.posCatalogPayload().posSettings.fiscalBlockCode], [' BT-2026-017 ', 'BT-2026-017'], 'catalog: fiscalBlockCode pushed to the tills (trimmed)'); }
// ── Kompania › Të dhënat: VAT registration toggle + number, both in the catalog company block
{ const g = c.settingsPage('Të dhënat e kompanisë'); const tg = g.cards[0].toggles.find(t => t.label === 'E regjistruar në TVSH'), vf = g.cards[0].fields.find(f => f.label === 'Numri i TVSH-së');
  eq([!!tg, tg.on, !!vf, vf.dis], [true, true, true, false], 'Kompania › Të dhënat: "E regjistruar në TVSH" toggle (on) + "Numri i TVSH-së" field');
  eq(c.posCatalogPayload().company.vatRegistered, true, 'catalog company.vatRegistered = true');
  tg.go(); eq([db().taxSettings.vatRegistered, c.vatOn(), c.settingsPage('Të dhënat e kompanisë').cards[0].fields.find(f => f.label === 'Numri i TVSH-së').dis], [false, false, true], 'toggle off → taxSettings.vatRegistered=false (single truth with Cilësime › Tatimet), VAT number field disabled');
  eq([c.posCatalogPayload().company.vatRegistered, c.posCatalogPayload().company.vatNo], [false, ''], 'catalog: vatRegistered=false ships an empty vatNo (nothing to print on the coupon)');
  eq(c.settingsPage('Tatimet').cards[0].toggles[0].on, false, 'Cilësime › Tatimet mirrors the same flag'); }
// non-VAT mode: every sales document in group A, no VAT anywhere
eq([c.effTax('E'), c.effTax('D'), c.effTax('A'), c.effRate('E'), c.effRate('D')], ['A', 'A', 'A', 0, 0], 'effTax/effRate: group A / 0 % when the company is not VAT-registered');
c.state.m.lines = [c.newLine()]; c.setLine(c.state.m.lines[0].id, { sku: 'PS-050', artQ: 'Panel sanduiç 50mm', tax: 'E', qty: '2' });
{ const e = c.evalLine(c.state.m.lines[0]); eq([e.taxCode, e.rate, e.line], ['A', 0, { sub: 3700, disc: 0, vatc: 0, tot: 3700 }], 'evalLine (non-VAT): letter E on the product → booked as A, 0 % VAT');
  const lv = c.lineVals(c.state.m.lines, (id, p) => c.setLine(id, p), () => {}, 'sale')[0]; eq([lv.taxOpts.map(o => o.code), lv.opts.length > 0 && lv.opts.every(o => o.rate === 0)], [['A'], true], 'line editor (non-VAT): only group A offered, catalogue rates shown as 0 %');
  c.setState({ m: { ...c.state.m, sel: { 'Drini Market SH.P.K.': true } } }); const b = c.buildOneBatch(); eq([b[0].items[0].tax, b[0].items[0].rate, b[0].items[0].vatc], ['A', 0, 0], 'buildOneBatch (non-VAT): items carry tax A, no VAT');
  const nos = c.issueBatch(b, 'issue', { date: '2026-09-20', due: '2026-10-05' }); const inv = db().invoices.find(r => r.no === nos[0]); eq([inv.vat, inv.sub === inv.total, inv.items[0].tax], [0, true, 'A'], 'issued invoice (non-VAT): vat 0, total = net, line letter A');
  const h = c.docPrintHtml(inv); eq([/<td class="r">A<\/td>/.test(h), /<span>TVSH<\/span>/.test(h), / · TVSH /.test(h)], [true, false, false], 'A4 print (non-VAT): letter A per line, no TVSH total line, no VAT number in the header');
  c.state.section = 'shitje'; c.state.page = 'Fatura'; c.state.drawer = nos[0]; const v = c.renderVals(); const dec = v.inv; eq([dec.no, dec.vatOn, dec.items[0].vat], [nos[0], false, 'A'], 'invoice drawer (non-VAT): vatOn=false hides the TVSH line, items show A'); c.state.drawer = null;
  const ex = c.buildExcelBatch(c.buildExcelRows('Klienti\tArtikulli\tSasia\nDrini Market SH.P.K.\tPanel sanduiç 50mm\t1\n').rows); eq([ex[0].items[0].tax, ex[0].items[0].rate, ex[0].items[0].vatc], ['A', 0, 0], 'Excel batch (non-VAT): group A, no VAT');
  c.openForm('product'); c.setF({ tax: 'E' }); typeF('price', '10.00'); eq([c.state.frm.priceG, fld('priceG').hint.startsWith('pa TVSH')], ['10.00', true], 'product form (non-VAT): gross = net, hint says group A'); c.state.frm = null;
  const J = c.journal(); eq(J.filter(e => e.ref === nos[0])[0].lines.some(l => l[0] === '2400' && l[2] > 0), false, 'journal (non-VAT): no VAT payable posted for the invoice'); }
// POS receipts of a non-VAT company: booked in A with VAT 0 even if the till sent a VAT split
{ const R = rcpt('r-nv1', 'POS-0001/000090', 'final', 'fiscalized_sim', [it('LED-18', 'LED', 1000, 890)], 1050, 0);
  c.importPosSales([R], []); const d = db().posReceipts.find(r => r.id === 'r-nv1'); eq([d.vat, d.sub, d.total, d.items[0].tax, d.items[0].rate, d.items[0].vatc, d.items[0].sub], [0, 1050, 1050, 'A', 0, 0, 1050], 'importPosSales (non-VAT): sub = total, VAT 0, lines in group A — the paid total is untouched');
  eq(c.salesDocs().find(x => x.id === 'r-nv1').vat, 0, 'salesDocs (non-VAT): the receipt reports no VAT'); }
// back to a VAT-registered company: letters/rates come back untouched (they were data all along)
c.settingsPage('Të dhënat e kompanisë').cards[0].toggles.find(t => t.label === 'E regjistruar në TVSH').go();
eq([c.vatOn(), c.evalLine(c.state.m.lines[0]).taxCode, c.evalLine(c.state.m.lines[0]).rate, c.posCatalogPayload().company.vatNo], [true, 'E', 18, '330012345'], 'VAT registration back on → product letters/rates apply again, vatNo back in the catalog');
// ── importPosSales: qty_q / unit_t / disc_c / tax letter, cancel reason, tax-block receipts
{ const ledB = stock('LED-18'), cashB = c.accountBalance('cash1');
  // 1.2345 pcs × 0.8913 net, value discount 0.05, ATK letter E; the POS computed the money, the ERP books what it sent
  const line = { sku: 'LED-18', name: 'Ndriçues LED 18W', unit: 'copë', qty_q: 12345, unit_t: 8913, rate: 18, tax: 'E', disc_bp: 0, disc_c: 5, sub_c: 105, vat_c: 19, tot_c: 124 };
  const R4 = rcpt('r-q4', 'POS-0001/000091', 'final', 'fiscalized_sim', [line], 124, 0);
  c.importPosSales([R4], []); const d = db().posReceipts.find(r => r.id === 'r-q4'); const i = d.items[0];
  eq([i.qty, i.qty_q, i.unit_c, i.unit_t, i.disc, i.disc_c, i.tax, i.sub, i.vatc, i.tot], [1.2345, 12345, 89, 8913, 0, 5, 'E', 105, 19, 124], 'importPosSales: qty_q/unit_t win over qty_m/unit_c (kept alongside the cents), disc_c value discount, ATK letter stored');
  eq([Math.round((ledB - stock('LED-18')) * 1000), c.accountBalance('cash1') - cashB], [1235, 124], 'importPosSales: stock moves by the quantity rounded to thousandths (1.2345 → 1.235), cash by the paid total');
  c.openDr('pos', 'r-q4'); const row = c.drawerVals().sections[0].rows[0].cells; eq([row[2].t, row[3].t, row[4].t, row[5].t], ['1.2345 copë', '€0.8913', '−€0.05', 'E · 18%'], 'POS drawer: 4-decimal quantity and unit price, value discount, letter + rate'); c.state.dr = null;
  const RO = rcpt('r-q5', 'POS-0001/000092', 'final', 'fiscalized_sim', [it('LED-18', 'LED', 1000, 890)], 1050, 0); c.importPosSales([RO], []);
  c.openDr('pos', 'r-q5'); const row2 = c.drawerVals().sections[0].rows[0].cells; eq([row2[2].t, row2[3].t, row2[4].t, row2[5].t], ['1 copë', '€8.90', '—', 'E · 18%'], 'POS drawer: an older-shape line (qty_m/unit_c, no tax) reads as before, letter derived from the rate'); c.state.dr = null; }
{ // cancel with a reason
  const R6 = rcpt('r-q6', 'POS-0001/000093', 'final', 'fiscalized_sim', [it('LED-18', 'LED', 1000, 890)], 1050, 0, { atk_transaction_id: 'ATK-TX-93' }); c.importPosSales([R6], []);
  const RC = rcpt('r-q6c', 'POS-0001/000094', 'cancel', 'fiscalized_sim', [], -1050, 0, { orig_id: 'r-q6', cancel_reason: 'Klienti hoqi dorë nga blerja', atk_transaction_id: 'ATK-TX-94' });
  c.importPosSales([RC, { ...R6, status: 'void' }], []); const cd = db().posReceipts.find(r => r.id === 'r-q6c'), od = db().posReceipts.find(r => r.id === 'r-q6');
  eq([cd.cancelReason, od.cancelReason, od.status, cd.total], ['Klienti hoqi dorë nga blerja', 'Klienti hoqi dorë nga blerja', 'Anuluar', -1050], 'cancel receipt: reason stored on the cancel AND the original');
  eq(/Arsyeja: Klienti hoqi dorë nga blerja/.test(db().queue.find(q => q.ref === 'POS-0001/000094').reason), true, 'fiscal queue: cancel row carries the reason');
  c.openDr('pos', 'r-q6c'); eq(c.drawerVals().meta.find(m => m.k === 'Arsyeja e anulimit').v, 'Klienti hoqi dorë nga blerja', 'POS drawer: "Arsyeja e anulimit"'); c.state.dr = null;
  c.importPosSales([{ ...RC, reason: 'Gabim në artikull', cancel_reason: undefined }], []); eq(db().posReceipts.find(r => r.id === 'r-q6c').cancelReason, 'Gabim në artikull', 're-pull: the reason refreshes (also read from `reason`)'); }
{ // receipt issued on the paper tax block while the till was down, registered afterwards
  const ledB = stock('LED-18'), cashB = c.accountBalance('cash1');
  const RB = rcpt('r-b1', 'POS-0001/000095', 'final', 'fiscalized_sim', [it('LED-18', 'LED', 2000, 890)], 2100, 0, { source: 'block', block_no: '000123', block_code: 'BT-2026-017', block_ts: '2026-09-19 10:15' });
  c.importPosSales([RB], []); const d = db().posReceipts.find(r => r.id === 'r-b1');
  eq([d.source, d.blockNo, d.blockCode, d.blockTs, d.kind, d.status], ['block', '000123', 'BT-2026-017', '2026-09-19 10:15', 'Kupon POS', 'Finalizuar'], 'block receipt: source + block fields stored, booked as an ordinary sale');
  eq([ledB - stock('LED-18'), c.accountBalance('cash1') - cashB], [2, 2100], 'block receipt: stock out and cash in like any sale');
  c.state.section = 'pos'; c.state.page = 'Shitje'; const t = c.pageTable('P:Shitje'); const row = t.rows.find(r => r.cells[0].t === 'POS-0001/000095'); eq(row.cells[0].sub, 'nga blloku tatimor nr. 000123 (BT-2026-017)', 'POS › Shitje: "nga blloku tatimor nr. …" under the coupon number');
  c.openDr('pos', 'r-b1'); const dv = c.drawerVals(); eq([/nga blloku tatimor nr\. 000123/.test(dv.subtitle), dv.meta.find(m => m.k === 'Blloku tatimor').v], [true, 'nr. 000123 · kodi BT-2026-017 · lëshuar 2026-09-19 10:15'], 'POS drawer: block subtitle + meta row'); c.state.dr = null;
  eq(db().queue.find(q => q.ref === 'POS-0001/000095').reason.startsWith('nga blloku tatimor nr. 000123'), true, 'fiscal queue: block receipts are labelled');
  eq(db().posReceipts.find(r => r.id === 'r-q5').source, undefined, 'ordinary receipts carry no source/block fields');
  c.importPosSales([{ ...RB, block_no: '000124' }], []); eq(db().posReceipts.find(r => r.id === 'r-b1').blockNo, '000124', 're-pull refreshes the block fields, never the books');
  const J = c.journal(); eq(J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal still balanced after 4-decimal, cancel-reason and block receipts'); }
// ══ Faza B · E0 + E-P: fixed clock, movement index, paging, units, recipes, the POS flag, the catalogue ══
c.state.db = c.seedDb(); c.state.dr = null; c.state.frm = null; c.state.drawer = null; c.state.admin = false; c.state.pdq = ''; c.state.fq = ''; c.state.pFilter = 'Të gjitha';
eq([c.today(), new ctx.Date().getFullYear(), c.nextNo('FSH')(1)], ['2026-09-20', 2026, 'FSH-2026-00126'], 'clock: the vm runs on the fixed calendar (2026-09-20) — reports and numbering never depend on the real day');
eq([c.qs({ since: 5, limit: 200, q: 'a b&c', x: '', y: null, z: undefined }), c.qs({}), qsOf('/pos/ledger' + c.qs({ since: 7, q: 'ë/1' }))], ['?since=5&limit=200&q=a%20b%26c', '', { since: '7', q: 'ë/1' }], 'qs(): query string without URL/URLSearchParams (empty values skipped), read back by the mock server');
// ── movement index: the same numbers as the old O(M) scans, on the seed and on random books; it follows pushes and replaced arrays
{ const oldStock = (d, sku) => { const p = d.products.find(x => x.sku === sku); if (!p) return 0; return p.opening + d.movements.filter(m => m.sku === sku).reduce((a, m) => a + m.qm, 0); };
  const oldStockWh = (d, sku, wh) => { const p = d.products.find(x => x.sku === sku); if (!p) return 0; const main = c.mainWh(d); return (wh === main ? p.opening : 0) + d.movements.filter(m => m.sku === sku && (m.wh || main) === wh).reduce((a, m) => a + m.qm, 0); };
  const oldAvg = (d, sku) => { const p = d.products.find(x => x.sku === sku); if (!p) return 0; let q = p.opening, v = p.opening * (p.openCost_c ?? p.cost_c); for (const m of d.movements) { if (m.sku === sku && m.qm > 0 && m.type !== 'transfer') { q += m.qm; v += m.qm * m.unit_c; } } return q > 0 ? Math.round(v / q) : p.cost_c; };
  const same = (d, what) => { const skus = [...new Set([...d.products.map(p => p.sku), ...d.movements.map(m => m.sku), 'NOPE'])], whs = [...(d.warehouses || []).map(w => w.id), 'W9', '', undefined]; const bad = [];
    for (const s of skus) { if (c.stockOf(s, d) !== oldStock(d, s)) bad.push('stock ' + s); if (c.avgCost(d, s) !== oldAvg(d, s)) bad.push('avg ' + s); for (const w of whs) if (c.stockOfWh(s, w, d) !== oldStockWh(d, s, w)) bad.push('wh ' + s + '@' + w); }
    eq(bad, [], 'movement index = old O(M) scans: ' + what + ' (' + skus.length + ' skus × ' + whs.length + ' warehouses, ' + d.movements.length + ' movements)'); };
  same(c.state.db, 'seed');
  c.transferStock({ from: 'W1', to: 'W2', items: [{ name: 'Panel', sku: 'PS-050', unit: 'm²', qty: 12 }], date: '2026-09-20', note: '' });
  c.adjustStock({ sku: 'LED-18', counted_qm: 20000, note: '', date: '20.09.2026' }); same(c.state.db, 'seed after a transfer + an adjustment');
  let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 3; run++) {
    const products = Array.from({ length: 12 }, (_, i) => ({ sku: 'R' + i, opening: rnd(4) ? rnd(50) * 1000 : 0, cost_c: 1 + rnd(900), ...(rnd(3) ? { openCost_c: rnd(2) ? rnd(700) : 0 } : rnd(2) ? { openCost_c: null } : {}) }));
    products.push({ sku: 'R3', opening: 999000, cost_c: 1 }); // a duplicate sku: the first record wins (like Array.find)
    const T = ['sale', 'purchase', 'adjust', 'transfer', 'sale_return', 'sale_cancel', 'return_cancel', 'purchase_return'], W = ['W1', 'W2', 'W3', '', undefined, null];
    const movements = Array.from({ length: 600 }, () => ({ sku: 'R' + rnd(14), qm: (rnd(2) ? 1 : -1) * rnd(20000), type: T[rnd(T.length)], wh: W[rnd(W.length)], unit_c: rnd(1500), ref: 'D' + rnd(40), date: '01.09.2026' }));
    same({ products, movements, warehouses: run === 2 ? [{ id: 'W2', name: 'B' }, { id: 'W1', name: 'A', main: true }] : [{ id: 'W1', name: 'A' }, { id: 'W2', name: 'B' }, { id: 'W3', name: 'C' }] }, 'random books #' + (run + 1)); }
  const d = { products: [{ sku: 'A', opening: 1000, cost_c: 100 }], movements: [{ sku: 'A', qm: 1000, type: 'purchase', unit_c: 300, wh: 'W2', ref: 'BL-1', docId: 'x1' }], warehouses: [{ id: 'W1', main: true }, { id: 'W2' }] };
  const x0 = c.mvIndex(d); eq([c.stockOf('A', d), c.avgCost(d, 'A'), c.stockOfWh('A', 'W2', d), c.mvByDoc(d, 'x1').length, c.mvByRef(d, 'BL-1').length], [2000, 200, 1000, 1, 1], 'index: built once per movements array');
  d.movements.push({ sku: 'A', qm: -500, type: 'sale', unit_c: 200, wh: 'W2', ref: 'FSH-1', docId: 'x2' });
  eq([c.stockOf('A', d), c.stockOfWh('A', 'W2', d), c.mvByRef(d, 'FSH-1').length, c.mvByDoc(d, 'x2').length, c.mvIndex(d) === x0], [1500, 500, 1, 1, true], 'index: a push into the same array extends it in place');
  d.movements = [d.movements[0], { sku: 'A', qm: 2000, type: 'purchase', unit_c: 600, ref: 'BL-2' }];
  eq([c.stockOf('A', d), c.stockOfWh('A', 'W1', d), c.avgCost(d, 'A'), c.mvByRef(d, 'FSH-1').length, c.mvByRef(d, 'BL-2').length, c.mvByDoc(d, 'x2').length], [4000, 3000, 400, 0, 1, 0], 'index: a replaced array (same length) is indexed afresh — the movement without `wh` sits in the main warehouse');
  d.movements.pop(); eq([c.stockOf('A', d), c.avgCost(d, 'A'), c.mvByRef(d, 'BL-2').length], [2000, 200, 0], 'index: an array that shrank in place is rebuilt');
  d.products.push({ sku: 'B', opening: 5000, cost_c: 70 }); eq([c.stockOf('B', d), c.prodOf(d, 'B').cost_c], [5000, 70], 'prodOf: a product pushed into the same array is found');
  // `_srv` rows (the server ledger) move the stock but never the average cost
  d.movements.push({ sku: 'A', qm: 1000, type: 'sale_return', unit_c: 99999, ref: 'POS-1', _srv: 1 }, { sku: 'A', qm: -300, type: 'sale', unit_c: 200, ref: 'POS-2', docId: 'D:k:2026-09-20', _srv: 1 });
  eq([c.stockOf('A', d), c.avgCost(d, 'A'), c.mvByDoc(d, 'D:k:2026-09-20').length], [2700, 200, 1], 'avgCost ignores `_srv` rows (stock still counts them; indexed by docId too)'); }
// ── paging: Lëvizjet / Hyrje në stok / Dalje nga stok, Hyrje / Dalje / Pagesa and Ditari show the newest 500 rows + "Shfaq më shumë"
c.state.db = c.seedDb();
{ const all = t => (t.fullRows ? t.fullRows().length : -1), more = t => t.more && t.more(); const many = Array.from({ length: 1150 }, (_, i) => ({ date: '15.09.2026', type: i % 2 ? 'sale' : 'purchase', sku: 'LED-18', qm: i % 2 ? -1000 : 1000, wh: 'W1', ref: 'X-' + i, party: 'Test', unit_c: 510, note: '' }));
  c.state.db = { ...db(), movements: [...db().movements, ...many] }; const n = db().movements.length;
  c.go('stok', 'Lëvizjet'); let t = c.pageTable('Lëvizjet');
  eq([t.rows.length, t.hasMore, /^Shfaq më shumë \(500 nga 669 të tjera\)$/.test(t.moreLabel), t.footer.startsWith('Shfaqen 500 nga ' + n + ' lëvizje'), all(t)], [500, true, true, true, n], 'Lëvizjet: the newest 500 of ' + n + ' rows, "Shfaq më shumë", the export carries all');
  eq(t.rows[0].cells.some(x => x.t === 'X-1149'), true, 'Lëvizjet: newest first');
  more(t); t = c.pageTable('Lëvizjet'); eq([t.rows.length, t.hasMore], [1000, true], 'Shfaq më shumë → 1000 rows'); more(t); t = c.pageTable('Lëvizjet'); eq([t.rows.length, t.hasMore, t.moreLabel, t.footer.startsWith('Shfaqen')], [n, false, '', false], 'all rows → the button goes away');
  c.go('stok', 'Hyrje në stok'); t = c.pageTable('Hyrje në stok'); eq([t.rows.length, t.hasMore, c.state.mvLimit], [500, true, 0], 'go() starts a paged page again from 500 rows (Hyrje në stok)');
  c.state.db = c.seedDb(); c.state.payLimit = 4; t = c.pageTable('Pagesa'); eq([t.rows.length, t.hasMore, all(t), t.footer.startsWith('Shfaqen 4 nga ' + db().payments.length)], [4, true, db().payments.length, true], 'Pagesa: paged the same way');
  c.state.payLimit = 0; t = c.pageTable('Hyrje'); eq([t.rows.length, t.hasMore], [db().payments.filter(p => p.dir === 'in').length, false], 'Hyrje (payments): a short list has no button');
  const J = c.journal(); c.state.jLimit = 10; t = c.pageTable('Ditari'); const maxL = Math.max(...J.map(e => e.lines.length));
  eq([t.rows.length >= 10 && t.rows.length < 10 + maxL, t.hasMore, /regjistrime të tjera\)$/.test(t.moreLabel), all(t), /^Shfaqen \d+ nga 28 regjistrime$/.test(t.footer)], [true, true, true, J.reduce((a, e) => a + e.lines.length, 0), true], 'Ditari: whole entries up to the limit (an entry is never split), the export carries every line');
  t = c.pageTable('Hyrjet kontabël'); eq([t.rows.length, t.hasMore, all(t)], [10, true, J.length], 'Hyrjet kontabël: 10 entries of ' + J.length);
  c.go('kontab', 'Ditari'); t = c.pageTable('Ditari'); eq([t.rows.length, t.hasMore, c.state.jLimit], [J.reduce((a, e) => a + e.lines.length, 0), false, 0], 'Ditari: the seed (under 500 lines) shows everything');
  eq([html.includes('{{ tbl.moreLabel }}'), html.includes('sc-camel-on-click="{{ tbl.more }}"')], [true, true], 'table template: the "Shfaq më shumë" button is bound'); }
// ── units: the full list, whole-number vs. 3-decimal units, the product form's unit combo
c.state.db = c.seedDb();
eq(c.UNITS, ['copë', 'm', 'm²', 'm³', 'kg', 'l', 'pako', 'shishe', 'gotë', 'thes', 'kovë'], 'units: copë, m, m², m³, kg, l, pako, shishe, gotë, thes, kovë');
eq(c.UNITS.map(u => c.unitDecimals(u)), [0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0], 'units: copë/pako/shishe/gotë/thes/kovë whole numbers, the others 3 decimals');
{ const t = c.pageTable('Njësitë'); eq([/shishe, gotë/.test(t.sub), /cl \/ ml/.test(t.sub), t.rows.find(r => r.cells[0].t === 'kovë').cells[5].t, t.rows.find(r => r.cells[0].t === 'm²').cells[5].t], [true, true, '0', '3'], 'Njësitë page: the list, recipe note, decimals per unit');
  c.openForm('product'); const u = fld('unit'); eq([u.isCombo, u.opts.map(o => o.label), u.opts.find(o => o.label === 'gotë').sub, u.opts.find(o => o.label === 'l').sub], [true, c.UNITS, 'numra të plotë', 'deri në 3 decimale'], 'product form: the unit is a combo with all 11 units'); c.state.frm = null; }
// ── recipe products: rules, storage, unit lock
c.state.db = c.seedDb(); c.state.toast = null;
const P = (sku, name, unit, opening, cost_c, extra = {}) => ({ name, sku, barcode: '—', cat: 'Pije', unit, tax: 'E', price_c: 300, cost_c, openCost_c: cost_c, opening, minStock: 0, ...extra });
eq([c.addProduct(P('VOD', 'Vodka', 'l', 7000, 1200)), c.addProduct(P('LIM', 'Limon', 'copë', 20000, 10)), c.addProduct(P('SYR', 'Shurup', 'l', 0, 300))], [true, true, true], 'ingredients added (vodka 7 l, 20 limonë, shurup pa stok)');
eq(c.addProduct(P('KOK', 'Koktej', 'gotë', 0, 250, { price_c: 450, openCost_c: 250, cost_t: 25000, recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }] })), true, 'recipe product added: 4 cl vodka + ½ limon per gotë');
{ const k = c.prodOf(db(), 'KOK'); eq([k.opening, k.openCost_c, k.cost_c, k.cost_t, k.recipe, k.pos, c.isRecipe(k), c.recipeCost(k, db()), c.makeQm(k, db())], [0, 0, 0, 0, [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }], undefined, true, Math.round((1200 * 40 + 10 * 500) / 1000), 40000], 'recipe product stored with opening/cost 0; cost from the ingredients (€0.53), 40 can be made (limons run out first)'); }
const refused = (r, re, what) => { const msg = String(c.state.toast || ''); eq([r, re.test(msg)], [false, true], what + ' → “' + msg.slice(0, 70) + '…”'); c.state.toast = null; };
refused(c.addProduct(P('X1', 'X1', 'gotë', 0, 0, { recipe: [{ sku: 'KOK', qm: 1000 }] })), /ka vetë recetë/, 'recipe rule: an ingredient cannot itself be a recipe');
refused(c.updateProduct('LIM', { recipe: [{ sku: 'VOD', qm: 10 }] }), /përbërës te “Koktej”/, 'recipe rule: a product used as an ingredient cannot get a recipe');
refused(c.addProduct(P('X2', 'X2', 'gotë', 0, 0, { recipe: [{ sku: 'X2', qm: 1000 }] })), /vetvetes/, 'recipe rule: no self');
refused(c.addProduct(P('X3', 'X3', 'gotë', 0, 0, { recipe: [{ sku: 'NOPE', qm: 1000 }] })), /nuk ekziston/, 'recipe rule: ingredients must exist');
for (const qm of [0, -40, 1.5, '40']) refused(c.addProduct(P('X4', 'X4', 'gotë', 0, 0, { recipe: [{ sku: 'VOD', qm }] })), /më e madhe se 0/, 'recipe rule: qm must be a positive integer (' + JSON.stringify(qm) + ')');
refused(c.addProduct(P('X5', 'X5', 'gotë', 0, 0, { recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'VOD', qm: 10 }] })), /përsëritet/, 'recipe rule: an ingredient only once');
c.addProduct(P('GIN', 'Xhin', 'l', 3000, 900)); refused(c.updateProduct('GIN', { recipe: [{ sku: 'SYR', qm: 10 }] }), /gjendje fillestare, stok ose lëvizje/, 'recipe rule: a product with opening stock cannot become a recipe');
refused(c.updateProduct('PS-050', { recipe: [{ sku: 'SYR', qm: 10 }] }), /gjendje fillestare, stok ose lëvizje/, 'recipe rule: a product with opening + movements cannot become a recipe');
c.addProduct(P('TON', 'Tonik', 'shishe', 0, 80)); c.adjustStock({ sku: 'TON', counted_qm: 6000, note: '', date: '20.09.2026' });
refused(c.updateProduct('TON', { recipe: [{ sku: 'SYR', qm: 10 }] }), /gjendje fillestare, stok ose lëvizje/, 'recipe rule: opening 0 but stock from a movement → refused');
eq([db().products.filter(p => /^X\d$/.test(p.sku)).length, c.isRecipe(c.prodOf(db(), 'LIM')), c.isRecipe(c.prodOf(db(), 'VOD'))], [0, false, false], 'refused changes leave the books untouched');
// unit lock: opening / any movement / used in a recipe
eq(c.updateProduct('SYR', { unit: 'kg' }), true, 'unit change allowed while the product has no opening, movement or recipe use'); c.updateProduct('SYR', { unit: 'l' });
c.addProduct(P('KOK2', 'Koktej me shurup', 'gotë', 0, 0, { recipe: [{ sku: 'SYR', qm: 20 }] }));
refused(c.updateProduct('SYR', { unit: 'kg' }), /Njësia nuk ndryshohet/, 'unit lock: an ingredient of a recipe');
refused(c.updateProduct('VOD', { unit: 'shishe' }), /Njësia nuk ndryshohet/, 'unit lock: opening stock');
refused(c.updateProduct('TON', { unit: 'l' }), /Njësia nuk ndryshohet/, 'unit lock: a movement');
eq([c.updateProduct('VOD', { unit: 'l', name: 'Vodka 40%' }), c.prodOf(db(), 'VOD').name], [true, 'Vodka 40%'], 'unit lock: saving the same unit is fine');
eq([c.updateProduct('KOK2', { recipe: null }), c.prodOf(db(), 'KOK2').recipe, 'recipe' in c.prodOf(db(), 'KOK2'), c.unitLocked(db(), c.prodOf(db(), 'SYR'))], [true, undefined, false, false], 'recipe:null removes the recipe (and frees the ingredient\'s unit)');
c.updateProduct('KOK2', { recipe: [{ sku: 'SYR', qm: 20 }] });
eq(c.recipeQm('4 cl', 'l') + ' ' + c.recipeQm('40 ml', 'l') + ' ' + c.recipeQm('0.04', 'l') + ' ' + c.recipeQm('0,5 cl', 'l') + ' ' + c.recipeQm('1.5', 'copë') + ' ' + c.recipeQm('2', 'gotë'), '40 40 40 5 1500 2000', 'recipeQm: 4 cl = 40 ml = 0.04 l → 40; ½ cl → 5; other units in their own unit');
eq([c.recipeQm('4 cl', 'kg'), c.recipeQm('1.5 ml', 'l'), c.recipeQm('0.0405', 'l'), c.recipeQm('0', 'l'), c.recipeQm('abc', 'l')], [null, null, null, null, null], 'recipeQm: cl/ml only for litres, never below 1 ml, > 0');
// the product form: Lloji = Recetë → ingredient lines (no cost / opening / minimum), the cost and margin from the ingredients, "Shfaqe në POS"
c.openForm('product'); c.setF({ name: 'Gotë vere', sku: 'gl-ver', cat: 'Pije', catQ: 'Pije', unit: 'gotë', unitQ: 'gotë', tax: 'E' });
fld('rec').opts.find(o => o.label.startsWith('Recetë')).go();
{ const v = c.formVals(); eq([v.hasLines, v.noPrice, v.linesTitle, ['cost', 'costG', 'opening', 'minStock', 'packUnit'].some(k => v.fields.some(f => f.key === k)), v.fields.some(f => f.label === 'Kosto nga receta'), v.actions[0].disabled], [true, true, 'Përbërësit e recetës', false, true, true], 'product form (recipe): ingredient lines, no cost/opening/minimum fields, recipe cost shown, blocked until filled');
  eq(v.lines[0].opts.map(o => o.sku).filter(s => ['KOK', 'KOK2', 'VOD'].includes(s)), ['VOD'], 'recipe picker: stock products only (no recipe products)'); }
c.setFormLine(c.state.frm.lines[0].id, { sku: 'VOD', artQ: 'Vodka', qty: '12 cl' }); typeF('price', '3.00');
{ const v = c.formVals(); eq([v.lines[0].ev.qm, v.lines[0].srcLabel, v.fields.find(f => f.label === 'Kosto nga receta').value.startsWith(c.fmt(144)), v.actions[0].disabled], [120, 'Kosto e përbërësit (kosto mes.)', true, false], 'recipe line: "12 cl" → 120 ml; cost €1.44 per gotë; ready'); }
fld('pos').opts.find(o => o.label.startsWith('Jo')).go(); c.formVals().actions[0].go();
{ const g = c.prodOf(db(), 'GL-VER'); eq([!!g, g && g.recipe, g && g.opening, g && g.cost_c, g && g.pos, c.state.frm], [true, [{ sku: 'VOD', qm: 120 }], 0, 0, false, null], 'product form (recipe): saved with its recipe, opening/cost 0, hidden from the tills'); }
c.openForm('product', { name: 'Gabim', sku: 'GB-1', cat: 'Pije', catQ: 'Pije', unit: 'gotë', unitQ: 'gotë', tax: 'E', rec: true, lines: [{ ...c.newLine(), fresh: false, sku: 'VOD', artQ: 'Vodka', qty: '4 kg' }] }); typeF('price', '1.00');
{ const v = c.formVals(); eq([v.actions[0].disabled, /Kontrolloni sasinë te rreshti 1/.test(v.msg)], [true, true], 'recipe line: a quantity in the wrong unit blocks the save'); c.state.frm = null; }
c.openProduct('VOD'); c.drawerVals().actions[0].go(); { const v = c.formVals(); eq([fld('unit'), v.fields.some(f => f.label === 'Njësia' && f.isInfo && /nuk ndryshohet/.test(f.value)), v.fields.some(f => f.label === 'Lloji' && f.isInfo)], [undefined, true, true], 'edit form: a locked unit is an info field; an ingredient with stock cannot switch to a recipe'); c.state.frm = null; }
c.openProduct('KOK'); c.drawerVals().actions[0].go(); { const v = c.formVals(); eq([c.state.frm.rec, v.lines.map(l => [l.L.sku, l.L.qty, l.ev.qm]), v.lines[0].opts.some(o => o.sku === 'KOK'), v.actions[0].disabled], [true, [['VOD', '0.04', 40], ['LIM', '0.5', 500]], false, false], 'edit form of a recipe: pre-filled ingredient lines (qty in the ingredient unit), the product itself not offered'); c.state.frm = null; }
// drawers: the recipe, "përdoret në …", no stock actions on a recipe
c.openProduct('KOK'); { const d = c.drawerVals(); eq([d.badge.text, d.actions.map(a => a.label), d.meta.find(m => m.k === 'Mund të përgatiten').v, d.sections[0].title, d.sections[0].rows.length, d.totals[0].v], ['Recetë', ['Redakto', 'Faturo', 'Etiketë / barkod'], '40 gotë', 'Receta · për 1 gotë', 2, c.fmt(53)], 'recipe drawer: makeable qty, the recipe, no Rregullo stokun / Blerje e re / Transfero'); }
c.openProduct('LIM'); { const d = c.drawerVals(); eq([d.meta.find(m => m.k === 'Përdoret në').v, d.actions.some(a => a.label === 'Rregullo stokun')], ['Koktej', true], 'ingredient drawer: "Përdoret në Koktej"'); } c.state.dr = null;
// ── pickers: a recipe is never bought, ordered from a supplier, transferred or counted
{ const L = [{ ...c.newLine(), fresh: false, sku: '', artQ: 'Koktej' }]; const has = (kind) => { c.openForm(kind, { lines: L }); const r = c.formVals().lines[0].opts.some(o => o.sku === 'KOK'); c.state.frm = null; return r; };
  eq([has('purchase'), has('po'), has('transfer'), has('invoice'), has('quote'), has('order')], [false, false, false, true, true, true], 'pickers: recipe excluded from purchase / purchase order / transfer, offered on invoice / quote / order');
  c.openForm('adjust', { artQ: 'Koktej' }); eq(fld('art').opts.some(o => o.label === 'Koktej'), false, 'adjust: a recipe is not in the product list'); c.state.frm = null;
  eq([c.evalLine({ ...L[0], sku: 'KOK', qty: '1' }, 'purchase').err, c.evalLine({ ...L[0], sku: 'KOK', qty: '1' }, 'transfer').err, c.evalLine({ ...L[0], sku: 'KOK', qty: '1' }, 'sale').err], ['recipe', 'recipe', null], 'evalLine: a recipe line is an error only when buying / transferring');
  c.openForm('purchase', { supplier: db().suppliers[0].name, supplierQ: db().suppliers[0].name, lines: [{ ...L[0], sku: 'KOK', artQ: 'Koktej' }] }); eq([c.formVals().actions[0].disabled, /është recetë/.test(c.formVals().msg)], [true, true], 'purchase form: a recipe line blocks with a message'); c.state.frm = null;
  const t0 = c.stockOf('KOK'); c.adjustStock({ sku: 'KOK', counted_qm: 5000, note: '', date: '20.09.2026' }); eq([c.stockOf('KOK'), /recetë/.test(c.state.toast || '')], [t0, true], 'adjustStock refuses a recipe product'); c.state.toast = null; }
// ── invoices: a recipe line moves its ingredients (rounded half away from zero, `via`), never itself; makeable stock warns
const cust = db().customers[0];
const iline = (sku, qty, unit_c = 450) => { const l = c.calcLine({ unit_c, qm: Math.round(qty * 1000), rate: 18, bp: 0 }); return { name: (c.prodOf(db(), sku) || {}).name, sku, unit: 'gotë', qty, unit_c, rate: 18, tax: 'E', disc: 0, sub: l.sub, vatc: l.vatc, tot: l.tot }; };
const mvOf = ref => db().movements.filter(m => m.ref === ref).map(m => [m.type, m.sku, m.qm, m.via || '', m.unit_c]);
{ const v0 = c.stockOf('VOD'), l0 = c.stockOf('LIM');
  const [n1] = c.issueBatch([{ cust, items: [iline('KOK', 3)], note: '' }], 'issue', { date: '2026-09-20', due: '2026-10-05' });
  eq(mvOf(n1), [['sale', 'VOD', -120, 'KOK', 1200], ['sale', 'LIM', -1500, 'KOK', 10]], 'invoice: 3 × Koktej → 120 ml vodka + 1.5 limon out at their average cost, via KOK (no movement of KOK itself)');
  eq([c.stockOf('VOD') - v0, c.stockOf('LIM') - l0, c.stockOf('KOK')], [-120, -1500, 0], 'invoice: ingredient stock down, the recipe holds none');
  const [n2] = c.issueBatch([{ cust, items: [iline('KOK', 0.333)], note: '' }], 'issue', { date: '2026-09-20', due: '2026-10-05' });
  eq(mvOf(n2).map(m => m[2]), [-13, -167], 'invoice: 0.333 gotë → 13.32 → 13 ml, 166.5 → 167 (half away from zero)');
  const J = c.journal().filter(e => e.ref === n1); eq(J.find(e => /Kosto e mallit/.test(e.desc)).lines, [['5000', 159, 0], ['1300', 0, 159]], 'journal: the recipe sale posts the ingredients\' cost (144 + 15)');
  // R:Shitje › Sipas artikullit: the recipe product's cost = its ingredients (via), the ingredient's own row only its direct sales
  const [n3] = c.issueBatch([{ cust, items: [iline('VOD', 1, 2500)], note: '' }], 'issue', { date: '2026-09-20', due: '2026-10-05' });
  c.state.rp = 'all'; c.state.rTab = 'Sipas artikullit'; const t = c.pageTable('R:Shitje'); const row = sku => t.rows.find(r => r.cells[1].t === sku);
  eq([row('KOK').cells[4].t, row('VOD').cells[4].t], [c.fmt(159 + Math.round(13 * 1200 / 1000) + Math.round(167 * 10 / 1000)), c.fmt(1200)], 'R:Shitje by article: Koktej costs its ingredients (via), Vodka only its own sale');
  c.state.rTab = ''; c.state.rp = 'month';
  // the invoice form warns against the makeable quantity (40 − 3.333 sold → 36.667 → 36)
  c.openForm('invoice', { customer: cust.name, customerQ: cust.name, lines: [{ ...c.newLine(), fresh: false, sku: 'KOK', artQ: 'Koktej', qty: '50' }] });
  { const v = c.formVals(); eq([v.actions[2].disabled, /Koktej ka 36 gotë për t’u përgatitur nga përbërësit/.test(v.msg)], [false, true], 'invoice form: recipe stock warning uses the makeable quantity'); } c.state.frm = null;
  // cancel mirrors the ORIGINAL movements even after the recipe changed
  c.updateProduct('KOK', { recipe: [{ sku: 'VOD', qm: 60 }] });
  const v1 = c.stockOf('VOD'), l1 = c.stockOf('LIM'); c.cancelInvoice(n1);
  eq([mvOf(n1).filter(m => m[0] === 'sale_cancel'), c.stockOf('VOD') - v1, c.stockOf('LIM') - l1], [[['sale_cancel', 'VOD', 120, 'KOK', 1200], ['sale_cancel', 'LIM', 1500, 'KOK', 10]], 120, 1500], 'cancelInvoice: mirrors the invoice\'s own movements (old recipe, same cost), not the current recipe');
  c.updateProduct('KOK', { recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }] });
  // credit note: the ingredients come back pro rata, as they left; cancelling it mirrors the note
  const [n4] = c.issueBatch([{ cust, items: [iline('KOK', 4)], note: '' }], 'issue', { date: '2026-09-20', due: '2026-10-05' });
  c.updateProduct('KOK', { recipe: [{ sku: 'SYR', qm: 10 }] });
  const v2 = c.stockOf('VOD'), l2 = c.stockOf('LIM'), s2 = c.stockOf('SYR');
  const kr = c.createReturn({ kind: 'sale', ref: n4, items: [{ li: 0, qty: 1 }], date: '2026-09-20', reason: '', account: 'bank1' });
  eq([mvOf(kr), c.stockOf('VOD') - v2, c.stockOf('LIM') - l2, c.stockOf('SYR') - s2], [[['sale_return', 'VOD', 40, 'KOK', 1200], ['sale_return', 'LIM', 500, 'KOK', 10]], 40, 500, 0], 'credit note on a recipe line: ¼ of the ingredients back, at their original cost (never the current recipe)');
  eq(c.journal().filter(e => e.ref === kr).find(e => /Kthim malli/.test(e.desc)).lines, [['1300', 53, 0], ['5000', 0, 53]], 'credit note: goods back at cost in the journal');
  c.cancelReturn(kr); eq([mvOf(kr).filter(m => m[0] === 'return_cancel').map(m => [m[1], m[2]]), c.stockOf('VOD') - v2, c.stockOf('LIM') - l2], [[['VOD', -40], ['LIM', -500]], 0, 0], 'cancelReturn: mirrors the note\'s own movements (ingredients out again)');
  c.updateProduct('KOK', { recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }] }); }
// ── local POS import: recipe lines move their ingredients; returns restock nothing; cancels mirror the original
{ const kit = (sku, qty_q, extra = {}) => ({ ...it(sku, (c.prodOf(db(), sku) || {}).name, Math.round(qty_q / 10), 450), qty_q, ...extra });
  const v0 = c.stockOf('VOD'), l0 = c.stockOf('LIM'), cash0 = c.accountBalance('cash1');
  c.importPosSales([rcpt('r-k1', 'POS-0001/000201', 'final', 'fiscalized_sim', [kit('KOK', 15000)], 797, 0)], []);
  eq(mvOf('POS-0001/000201'), [['sale', 'VOD', -60, 'KOK', 1200], ['sale', 'LIM', -750, 'KOK', 10]], 'POS import: 1.5 Koktej → qty_q × qm / 10000 of each ingredient, via KOK');
  c.importPosSales([rcpt('r-k1r', 'POS-0001/000202', 'return', 'fiscalized_sim', [kit('KOK', -10000)], -531, 0, { orig_id: 'r-k1' })], []);
  eq([mvOf('POS-0001/000202'), c.stockOf('VOD') - v0, c.stockOf('LIM') - l0, c.accountBalance('cash1') - cash0], [[], -60, -750, 797 - 531], 'POS return of a recipe item: money back, NO ingredient restock (served = waste)');
  c.updateProduct('KOK', { recipe: [{ sku: 'VOD', qm: 60 }] });
  c.importPosSales([rcpt('r-k2', 'POS-0001/000203', 'final', 'fiscalized_sim', [kit('KOK', 20000), it('LED-18', 'LED', 1000, 890)], 1950, 0)], []);
  c.updateProduct('KOK', { recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }] });
  const v1 = c.stockOf('VOD'), l1 = c.stockOf('LIM'), d1 = c.stockOf('LED-18');
  c.importPosSales([{ ...rcpt('r-k2c', 'POS-0001/000204', 'cancel', 'fiscalized_sim', [], 0, 0, { orig_id: 'r-k2' }), sub_c: 0, vat_c: 0, total_c: 0 }], []);
  eq([mvOf('POS-0001/000204').map(m => [m[0], m[1], m[2], m[3]]), c.stockOf('VOD') - v1, c.stockOf('LIM') - l1, c.stockOf('LED-18') - d1], [[['sale_cancel', 'VOD', 120, 'KOK'], ['sale_cancel', 'LED-18', 1000, '']], 120, 0, 1000], 'POS cancel (no lines): mirrors the original\'s movements — the recipe as it was sold, the plain item too');
  c.importPosSales([rcpt('r-k3', 'POS-0001/000205', 'final', 'fiscalized_sim', [kit('KOK', 30000)], 1593, 0)], []);
  c.importPosSales([rcpt('r-k3c', 'POS-0001/000206', 'cancel', 'fiscalized_sim', [kit('KOK', 10000)], 531, 0, { orig_id: 'r-k3' })], []);
  eq([mvOf('POS-0001/000205').map(m => m[2]), mvOf('POS-0001/000206').map(m => [m[0], m[1], m[2]])], [[-120, -1500], [['sale_cancel', 'VOD', 40], ['sale_cancel', 'LIM', 500]]], 'POS cancel with its own (partial) lines: the original movements pro rata');
  const v4 = c.stockOf('VOD');
  c.importPosSales([rcpt('r-k4c', 'POS-0001/000207', 'cancel', 'fiscalized_sim', [kit('KOK', 10000)], 531, 0, { orig_id: 'r-not-here' })], []);
  eq([mvOf('POS-0001/000207').map(m => [m[0], m[1], m[2]]), c.stockOf('VOD') - v4], [[['sale_cancel', 'VOD', 40], ['sale_cancel', 'LIM', 500]], 40], 'POS cancel whose original is not in the books: its own lines, reversed through the recipe');
  const J = c.journal(); eq(J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0) === J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), true, 'journal balanced with recipe receipts, returns and cancels'); }
// ── journal: POS revenue (4000) and VAT (2400) each by its own sign
{ const mixed = rcpt('r-mx', 'POS-0001/000210', 'final', 'fiscalized_sim', [{ sku: 'LED-18', name: 'LED', unit: 'copë', qty_m: 1000, unit_c: 1000, rate: 0, tax: 'A', sub_c: 1000, vat_c: 0, tot_c: 1000 }, { sku: 'KB-325', name: 'Kabllo', unit: 'm', qty_m: -1000, unit_c: 500, rate: 18, tax: 'E', sub_c: -500, vat_c: -90, tot_c: -590 }], 410, 0);
  c.importPosSales([mixed], []); const e = c.journal().find(x => x.ref === 'POS-0001/000210' && x.lines.some(l => l[0] === '4000'));
  eq([e.lines.find(l => l[0] === '4000'), e.lines.find(l => l[0] === '2400'), e.lines.every(l => l[1] >= 0 && l[2] >= 0), e.lines.reduce((a, l) => a + l[1] - l[2], 0)], [['4000', 0, 500], ['2400', 90, 0], true, 0], 'journal: a mixed receipt (sale at 0 % + return at 18 %) posts revenue as a credit and the VAT refund as a debit — no negative amounts'); }
// ── stock pages: recipe rows only where stock makes sense; makeable quantity per warehouse in the catalogue
c.state.db = { ...db(), products: [...db().products, P('OLD', 'Recetë e vjetër', 'gotë', 3000, 100, { minStock: 9000, recipe: [{ sku: 'VOD', qm: 10 }] })] }; // legacy books: a recipe that still carries an opening / minimum
{ const has = (t, sku) => t.rows.some(r => r.cells.some(x => x.t === sku));
  eq([has(c.pageTable('Gjendja'), 'KOK'), has(c.pageTable('Inventar'), 'KOK'), has(c.pageTable('Gjendja'), 'OLD'), has(c.pageTable('Gjendja'), 'VOD')], [false, false, false, true], 'Gjendja / Inventar: no recipe rows');
  eq([has(c.pageTable('Lista e çmimeve'), 'KOK'), has(c.pageTable('Barkodet'), 'KOK')], [true, true], 'Lista e çmimeve / Barkodet still list recipe products');
  const dep = c.pageTable('Depo').rows.find(r => r.cells[0].t === 'W1'); eq(dep.cells[3].t, String(db().products.filter(p => !c.isRecipe(p) && c.stockOfWh(p.sku, 'W1') !== 0).length), 'Depo: article counts without recipe products');
  c.state.rTab = 'Lëvizjet sipas artikullit'; eq([has(c.pageTable('R:Stok'), 'OLD'), has(c.pageTable('R:Stok'), 'KOK'), has(c.pageTable('R:Stok'), 'LIM')], [false, false, true], 'R:Stok: no recipe rows'); c.state.rTab = '';
  c.state.section = 'dashboard'; c.state.page = 'Paneli'; const al = c.renderVals().alerts.find(a => /Stok i ulët/.test(a.t)); eq([!!al, /Recetë|Koktej/.test(al ? al.s : '')], [true, false], 'low-stock alert: never a recipe product (even one with a legacy minimum)');
  c.state.section = 'produkte'; c.state.page = 'Produktet'; const pr = c.renderVals().products.find(p => p.sku === 'KOK'); eq([!!pr, /recetë/.test(pr.stock), pr.low], [true, true, false], 'Produktet: the recipe product is listed (makeable qty, marked "recetë")');
  const cat = c.pageTable('Kategoritë').rows.find(r => r.cells[0].t === 'Pije'); eq(cat.cells[1].t, String(db().products.filter(p => p.cat === 'Pije').length), 'Kategoritë: recipe products counted in their category'); }
c.state.db = { ...db(), products: db().products.filter(p => p.sku !== 'OLD') };
{ const k = () => c.prodOf(db(), 'KOK'), wh = (sku, w) => c.stockOfWh(sku, w);
  eq([c.makeQm(k(), db(), 'W1'), c.makeQm(k(), db(), 'W2'), c.makeQm(k(), db())], [Math.min(Math.floor(wh('VOD', 'W1') / 40), Math.floor(wh('LIM', 'W1') / 500)) * 1000, 0, Math.min(Math.floor(c.stockOf('VOD') / 40), Math.floor(c.stockOf('LIM') / 500)) * 1000], 'makeQm: per warehouse and in total (nothing in W2)');
  c.transferStock({ from: 'W1', to: 'W2', items: [{ name: 'Vodka', sku: 'VOD', unit: 'l', qty: 0.2 }, { name: 'Limon', sku: 'LIM', unit: 'copë', qty: 2 }], date: '2026-09-20', note: '' });
  eq(c.makeQm(k(), db(), 'W2'), 4000, 'makeQm: 200 ml + 2 limonë in W2 → 4 cocktails');
  c.issueBatch([{ cust, items: [iline('LIM', 5, 20)], note: '' }], 'issue', { date: '2026-09-20', due: '2026-10-05', wh: 'W2' });
  eq([wh('LIM', 'W2'), c.makeQm(k(), db(), 'W2')], [-3000, 0], 'makeQm: clamped at 0 when an ingredient is negative');
  const cp = c.posCatalogPayload().products.find(p => p.sku === 'KOK');
  eq([cp.stock_qm, cp.stock_by_wh, Object.keys(cp).some(x => x === 'recipe' || x === 'pack')], [c.makeQm(k(), db()), { W1: c.makeQm(k(), db(), 'W1'), W2: 0 }, false], 'catalogue: a recipe ships its makeable quantity (per warehouse), never the recipe itself');
  c.updateProduct('LIM', { pack: { unit: 'thes', qm: 50000 } }); eq([c.prodOf(db(), 'LIM').pack, 'pack' in c.posCatalogPayload().products.find(p => p.sku === 'LIM')], [{ unit: 'thes', qm: 50000 }, false], 'pack: stored as info only, never sent to the tills');
  c.openProduct('LIM'); eq(c.drawerVals().meta.find(m => m.k === 'Paketimi').v, '1 thes = 50 copë', 'pack: shown in the product drawer'); c.state.dr = null;
  eq([c.posCatalogPayload().products.some(p => p.sku === 'GL-VER'), c.posCatalogPayload().products.some(p => p.sku === 'VOD'), c.posCatalogPayload().products.length, db().products.filter(p => p.pos !== false).length], [false, true, db().products.filter(p => p.pos !== false).length, db().products.length - 1], 'catalogue: only products shown on the tills (pos !== false)'); }
// zero visible products: never sent — silent on the timer, a toast only by hand
{ const all = db(); c.state.db = { ...all, products: all.products.map(p => ({ ...p, pos: false })) }; c.state.toast = null; c._catRefused = null;
  const h = c.posCatalogHash(); eq([c.posCatalogReady(false), c.state.toast, c._catRefused === h], [null, null, true], 'catalogue with zero visible products: refused silently on the timer, hash remembered');
  eq([c.posCatalogReady(true), c.state.toast], [null, c.CAT_EMPTY], 'catalogue with zero visible products: a manual push says why'); c.state.toast = null; c.state.db = all; }
// local / server sync with stubbed transports: nothing is pushed while nothing is visible, the manual sync names it, the timer stays quiet
(async () => {
  const off = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' };
  const p = new C({}); p._api = off; p.state.db = p.seedDb(); p.state.session = { name: 'Arben Berisha', role: 'Pronar', userId: 'u1' }; const calls = [];
  p.posFetch = async (path, o = {}) => { calls.push((o.method || 'GET') + ' ' + path.split('?')[0]); if (path === '/health') return { pos_name: 'Arka test', pos_id: 'POS-0001', version: '1', pending_sync: 0, fiscal: { pending: 0, mode: 'ATK_ELECTRONIC' } }; if (path.startsWith('/sales')) return { receipts: [], shifts: [], cursor: 0 }; if (path === '/catalog') return { imported: { products: JSON.parse(o.body).products.length, customers: 5 } }; return {}; };
  const hidden = p.state.db.products.map(x => ({ ...x, pos: false })); p.state.db = { ...p.state.db, products: hidden };
  await p.posSync(false); eq([calls.includes('POST /catalog'), p.state.toast, p._catRefused === p.posCatalogHash()], [false, null, true], 'local sync (timer), zero visible: no push, no toast');
  calls.length = 0; await p.posSync(false); eq(calls.filter(x => x === 'POST /catalog'), [], 'local sync (timer): the refused catalogue is not retried');
  await p.posSync(true); eq([calls.includes('POST /catalog'), p.state.toast.includes(p.CAT_EMPTY), p.state.toastColor], [false, true, '#B45309'], 'local sync (manual): the closing toast says the catalogue was not sent');
  p.state.toast = null; eq([await p.posPushCatalog(true), p.state.toast], [null, p.CAT_EMPTY], '"Dërgo katalogun te POS-i": refused with the reason');
  p.state.db = { ...p.state.db, products: hidden.map(x => x.sku === 'LED-18' ? { ...x, pos: true } : x) }; p.state.toast = null; calls.length = 0;
  await p.posSync(false); eq([calls.filter(x => x === 'POST /catalog').length, p.posCfg().catalogHash === p.posCatalogHash(), p.state.toast], [1, true, null], 'local sync (timer): one visible product → pushed, hash saved');
  const q = new C({}); q._api = off; q.state.db = { ...q.seedDb(), products: hidden }; q.state.session = p.state.session; const qc = [];
  q.apiFetch = async (path, o = {}) => { qc.push((o.method || 'GET') + ' ' + path.split('?')[0]); if (path === '/pos/status') return { terminals: [], unsyncedReceipts: 0 }; if (path.startsWith('/pos/sales')) return { receipts: [], shifts: [], cursor: 0 }; if (path === '/pos/catalog') return { version: 3 }; return {}; };
  await q.posSyncServer(false); eq([qc.includes('PUT /pos/catalog'), q.state.toast], [false, null], 'server sync (timer), zero visible: no catalogue PUT, no toast');
  await q.posSyncServer(true); eq([qc.includes('PUT /pos/catalog'), q.state.toast.includes(q.CAT_EMPTY)], [false, true], 'server sync (manual): the closing toast says the catalogue was not sent');
  q.state.db = { ...q.state.db, products: hidden.map(x => x.sku === 'LED-18' ? { ...x, pos: true } : x) }; await q.posSyncServer(false); eq([qc.filter(x => x === 'PUT /pos/catalog').length, q.posCfg().catalogVersionSrv], [1, 3], 'server sync: a visible catalogue is PUT');
  clearTimeout(p._t); clearTimeout(q._t);
})().catch(e => { console.log('FAIL catalogue push tests threw: ' + (e && e.stack || e)); process.exitCode = 1; });
// ══ Faza B · E-L: the server-side POS ledger (API mode, GET /health lists posLedger:1) — after the API block (it shares fetch / localStorage) ══
// The mock server keeps one book + one ledger per company; its /state/commit records a violation for every patch that carries `_srv` rows or
// posSync runtime fields (asserted at the end), /pos/ledger pages with since/limit/more/epoch/ready/mode and tombstones like kontabo-backend.
apiBlock.then(async () => {
  const wait = (ms = 3) => new Promise(r => setTimeout(r, ms)), until = async (f, n = 800) => { for (let i = 0; i < n && !f(); i++) await wait(); return !!f(); };
  const mem = {}, store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  ctx.localStorage = store; ctx.sessionStorage = store;
  ctx.AbortController = class { constructor() { const L = []; this._L = L; this.signal = { aborted: false, on: f => L.push(f) }; } abort() { this.signal.aborted = true; for (const f of this._L) f(); } };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(body)) });
  const RT = ['cursorSrv', 'lastSyncSrv', 'unsyncedSrv', 'catalogHashSrv', 'catalogVersionSrv', 'lastPush', 'lastError'];
  const S = { features: ['posLedger:1'], calls: [], bad: [], noHdr: [], T: {}, gate: null, open: null, timeouts: [] };
  const users = { own: { role: 'Pronar', perms: { fatura_shiko: true }, name: 'Arben Berisha', email: 'arben@abc-ks.com' }, kas: { role: 'Kasier', perms: { fatura_shiko: true, pos: true }, name: 'Fjolla Kastrati', email: 'fjolla@abc-ks.com' }, mag: { role: 'Magazinier', perms: { stok: true, produkte: true }, name: 'Driton Hoxha', email: 'driton@abc-ks.com' } };
  const mkT = (id, name, state = null, mode = 'off') => (S.T[id] = { id, name, version: state ? 1 : 0, state: state && JSON.parse(JSON.stringify(state)), commits: [], tries: 0, catVersion: 0, catalogs: [], known: new Set(), knownShifts: new Set(), knownCalls: [], activates: [], audit: [], resets: 0, onCommit: null, onActivate: null, notReadyAfterDone: 0, led: { epoch: 'E-' + id, top: 0, mode, notReady: 0, cap: 200, rows: new Map(), shifts: new Map() } });
  const pub = (T, r) => { r.rev = ++T.led.top; T.led.rows.set(r.id, r); return r; }, pubShift = (T, s) => { s.rev = ++T.led.top; T.led.shifts.set(s.id, s); return s; };
  const tomb = (T, id) => { const r = T.led.rows.get(id); pub(T, { id, kind: r.kind, removed: true, date: r.date, terminal: r.terminal }); };
  const whoOf = h => { const x = /^Bearer L-(\w+)-(\w+)$/.exec(h || ''); return x && users[x[1]] ? { ...users[x[1]], key: x[1], tid: x[2] } : null; };
  const posOk = u => u.role === 'Pronar' || !!u.perms.pos; // the server's has_perm('pos')
  const jOf = (who, tid) => ({ accessToken: 'L-' + who + '-' + tid, refreshToken: 'r-' + who, user: { id: 'g-' + who, name: users[who].name, email: users[who].email, isPlatformAdmin: false }, tenant: { id: tid, name: S.T[tid].name, role: users[who].role, branch: 'Qendra', perms: users[who].perms, plan: 'pro' }, tenants: Object.values(S.T).map(t => ({ id: t.id, name: t.name, role: users[who].role })) });
  ctx.fetch = async (url, o = {}) => {
    const path = url.replace(/^http:\/\/[^/]+\/api\/v1/, ''), m = o.method || 'GET', body = o.body ? JSON.parse(o.body) : {}, h = o.headers || {}, u = whoOf(h.Authorization), q = qsOf(path), p = path.split('?')[0];
    S.calls.push({ m, p, path, who: u && u.key, tid: u && u.tid, body });
    if (h['X-Kontabo-Client'] !== '2') S.noHdr.push(m + ' ' + p);
    if (p === '/health') return json(200, { ok: true, app: 'Kontabo Backend', version: '0.2.0', db: 'sqlite', features: S.features });
    if (p === '/hang') return new Promise((res, rej) => o.signal.on(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (!u || !S.T[u.tid]) return json(401, { error: 'unauthorized', message: 'token' });
    const T = S.T[u.tid];
    if (p === '/state' && m === 'GET') return json(200, { version: T.version, state: T.state });
    if (p === '/state' && m === 'PUT') { if (body.baseVersion !== T.version) return json(409, { error: 'version_conflict', version: T.version }); T.state = body.state; T.version++; return json(200, { version: T.version }); }
    if (p === '/state/commit') { T.tries++; const txt = JSON.stringify(body.patch || {}), ps = (body.patch || {}).posSync;
      if (txt.includes('"_srv"')) S.bad.push(T.id + ': a commit carries `_srv` rows');
      if (ps && S.features.includes('posLedger:1')) for (const k of RT) if (JSON.stringify(ps[k]) !== JSON.stringify(((T.state || {}).posSync || {})[k])) S.bad.push(T.id + ': posSync.' + k + ' committed');
      if (T.onCommit) { const r = T.onCommit(body.patch); if (r) return r; }
      if (body.baseVersion !== T.version) return json(409, { error: 'version_conflict', version: T.version, state: T.state });
      for (const k in body.patch) T.state[k] = body.patch[k]; T.version++; T.commits.push(body.patch); return json(200, { version: T.version, ignored: [] }); }
    if (p === '/users') return json(200, { users: Object.entries(users).map(([k, x], i) => ({ id: 'm' + (i + 1), userId: 'g-' + k, name: x.name, email: x.email, role: x.role, branch: 'Qendra', dept: '—', status: 'Aktiv', pinSalt: 'a1b2c3d4', pinHash: 'h-' + k })) });
    if (p === '/roles') return json(200, { roles: { Pronar: { fatura_shiko: true }, Kasier: { fatura_shiko: true, pos: true }, Magazinier: { stok: true, produkte: true } } });
    if (p === '/audit') { if (m === 'POST') { T.audit.push(body.action); return json(200, { item: { id: T.audit.length, t: 'now', u: u.name, a: body.action } }); } return json(200, { items: [] }); }
    if (p === '/terminals') return json(200, { terminals: T.terms || [] });
    if (p === '/auth/logout') return json(200, { ok: true });
    if (p === '/auth/switch-tenant') return json(200, jOf(u.key, body.tenantId));
    if (p === '/pos/status') return posOk(u) ? json(200, { terminals: [], catalogVersion: T.catVersion, unsyncedReceipts: 0 }) : json(403, { error: 'forbidden', message: 'Nuk keni leje' });
    if (p === '/pos/catalog' && m === 'PUT') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); T.catalogs.push(body.catalog); T.catVersion++; return json(200, { version: T.catVersion }); }
    if (p === '/pos/sales') return json(200, { receipts: [], shifts: [], cursor: +q.since || 0 });
    if (p === '/pos/ack') return json(200, { acked: 0 });
    if (p === '/pos/ledger') { if (S.gate && S.gate.tid === T.id) await S.gate.p;
      const since = +q.since || 0, lim = Math.min(+q.limit || 200, T.led.cap), all = [...[...T.led.rows.values()].map(x => ['r', x]), ...[...T.led.shifts.values()].map(x => ['s', x])].filter(([, x]) => x.rev > since).sort((a, b) => a[1].rev - b[1].rev);
      const page = all.slice(0, lim), more = all.length > lim, ready = !(T.led.notReady > 0 && T.led.notReady--);
      return json(200, { epoch: T.led.epoch, rev: more ? page[page.length - 1][1].rev : T.led.top, mode: T.led.mode, ready, pending: ready ? 0 : 2, rows: page.filter(x => x[0] === 'r').map(x => x[1]), shifts: page.filter(x => x[0] === 's').map(x => x[1]), more }); }
    if (p === '/pos/receipts/known') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); T.knownCalls.push(body); if (T.onKnown) T.onKnown(body); const seen = new Set(); return json(200, { known: (body.ids || []).filter(x => T.known.has(x) && !seen.has(x) && seen.add(x)), knownShifts: (body.shiftIds || []).filter(x => T.knownShifts.has(x)) }); }
    if (p === '/pos/ledger/activate') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); T.activates.push(body); if (T.onActivate) T.onActivate(body); if (body.done) { T.led.mode = 'on'; T.led.notReady = T.notReadyAfterDone; } return json(200, { updated: (body.receipts || []).filter(r => T.known.has(r.id)).length, mode: T.led.mode }); }
    if (p === '/pos/ledger/reset') { if (u.role !== 'Pronar') return json(403, { error: 'forbidden', message: 'Vetëm pronari' }); T.resets++; T.led.epoch += '-r' + T.resets; for (const [id, r] of [...T.led.rows]) if (!r.removed) tomb(T, id); for (const s of [...T.led.shifts.values()]) if (!s.removed) pubShift(T, { ...s, removed: true }); return json(200, { epoch: T.led.epoch, resetSeq: 99 }); }
    // receipts one by one (kontabo-backend GET /pos/receipts, /pos/receipts/{id}): any member; filters, newest first, limit/offset, total
    if (S.rcHold && /^\/pos\/receipts(\/|$)/.test(p) && m === 'GET') { const hold = S.rcHold(T.id, path); if (hold) await hold; } // a test holds one answer back (late / out-of-order answers)
    if (p === '/pos/receipts' && m === 'GET') { if (T.rcDeny) return json(403, { error: 'forbidden', message: 'Nuk keni leje' });
      if (+q.limit > 200) return json(400, { error: 'validation_error', message: 'limit' }); const to = q.to || '2026-09-20', from = q.from || c.addDays(to, -30), sts = (q.status || '').split(',').filter(Boolean), qq = (q.q || '').toLowerCase();
      const L = (T.rc || []).filter(r => r.day >= from && r.day <= to && (!q.terminal || r.terminalKey === q.terminal) && (!sts.length || sts.includes(r.status)) && (q.fiscal !== 'open' || !['fiscalized', 'fiscalized_sim', 'cancelled'].includes(r.fiscalStatus)) && (!qq || (r.no + ' ' + r.operator).toLowerCase().includes(qq)))
        .sort((a, b) => b.day.localeCompare(a.day) || b.ts.localeCompare(a.ts) || b.seq - a.seq), lim = +q.limit || 50, off = +q.offset || 0;
      return json(200, { items: L.slice(off, off + lim), total: L.length }); }
    if (p.startsWith('/pos/receipts/') && m === 'GET') { if (T.rcDeny) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); const id = decodeURIComponent(p.slice('/pos/receipts/'.length)), it = (T.rc || []).find(r => r.id === id);
      if (!it) return json(404, { error: 'not_found', message: 'Kuponi nuk u gjet' }); return json(200, { ...it, related: (T.rc || []).filter(r => r.id !== id && (r.id === it.origId || r.origId === id)) }); }
    // read-only API keys (permission `kompania`; the Pronar always) and terminal token rotation (permission `pos`)
    if (p === '/api-keys' || p.startsWith('/api-keys/')) { if (u.role !== 'Pronar' && !u.perms.kompania) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); T.keys = T.keys || [];
      if (m === 'GET') return json(200, { apiKeys: T.keys.slice().reverse() });
      if (m === 'POST') { const nm = String(body.name || '').trim(), sc = body.scopes || []; if (!nm || nm.length > 80 || !sc.length || sc.some(x => !['pos:read', 'state:read'].includes(x))) return json(400, { error: 'validation_error', message: 'Të dhënat e kërkesës janë të pavlefshme' });
        const raw = 'kk_' + T.id + 'SECRET' + (T.keys.length + 1) + 'x'.repeat(32), k = { id: 'key-' + (T.keys.length + 1), name: nm, prefix: raw.slice(0, 12), scopes: ['pos:read', 'state:read'].filter(x => sc.includes(x)), createdBy: u.name, createdAt: '2026-09-20T10:00:00Z', lastUsedAt: null, revokedAt: null };
        T.keys.push(k); T.rawKeys = [...(T.rawKeys || []), raw]; return json(200, { key: raw, apiKey: k }); }
      if (m === 'DELETE') { const k = T.keys.find(x => x.id === decodeURIComponent(p.slice('/api-keys/'.length))); if (!k) return json(404, { error: 'not_found', message: 'Çelësi nuk u gjet' }); if (!k.revokedAt) k.revokedAt = '2026-09-20T11:00:00Z'; return json(200, { apiKey: k }); } }
    { const rot = /^\/terminals\/([^/]+)\/rotate$/.exec(p); if (rot && m === 'POST') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); if (!(T.terms || []).some(x => x.id === rot[1])) return json(404, { error: 'not_found', message: 'Terminali nuk u gjet' }); T.rotations = (T.rotations || 0) + 1; return json(200, { token: 'kt_new' + T.rotations }); } }
    return json(404, { error: 'not_found', message: path });
  };
  const calls = (tid, re) => S.calls.filter(x => x.tid === tid && re.test(x.m + ' ' + x.p));
  const mk = () => { const x = new C({}); x._api = { url: 'http://127.0.0.1:8801/api/v1', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenantPlan: '', tenantSince: '', trialEndsAt: '', tenants: [], remember: true, status: '', lastError: '' }; x.state.db = null; x.state.session = null; x.LEDGER_POLL = 5;
    const af = x.apiFetch.bind(x); x.apiFetch = (pth, op = {}, r) => { if (/^\/pos\/ledger/.test(pth)) S.timeouts.push(pth.split('?')[0] + ' ' + op.timeout); return af(pth, op, r); }; return x; };
  const enter = async (x, who, tid, greet = true) => { store.removeItem('kontabo.finance.pending'); await x.apiEnter(jOf(who, tid), true, greet); await until(() => x._ledger === null || (x._ledger && x._ledger.loaded)); };
  const done = x => { clearTimeout(x._t); clearTimeout(x._retryT); };
  // ── books and ledger rows shaped like kontabo-backend's (tests/test_pos_ledger.py)
  const base = new C({}); base._ledFeat = true;
  const PRODUCTS = [P('KAFE', 'Kafe', 'copë', 100000, 30), P('UJE', 'Ujë', 'shishe', 5000, 20), P('RUM', 'Rum', 'l', 10000, 2000), P('MOJ', 'Mojito', 'gotë', 0, 0, { recipe: [{ sku: 'RUM', qm: 40 }] }), P('LIM', 'Limon', 'copë', 0, 10)];
  const book = (extra = {}) => ({ ...base.seedEmpty({ name: 'ABC SH.P.K.' }), products: PRODUCTS, categories: base.migrateCats({ products: PRODUCTS }).categories,
    warehouses: [{ id: 'W1', name: 'Depoja kryesore', branch: 'Qendra', main: true }, { id: 'W2', name: 'Bari', branch: 'Qendra', main: false }],
    accounts: [{ id: 'bank1', name: 'Banka', type: 'Bankë', detail: '—', opening_c: 0 }, { id: 'cash1', name: 'Arka Bar', type: 'Arkë', detail: 'BAR-1', opening_c: 0 }, { id: 'cash2', name: 'Arka 2', type: 'Arkë', detail: 'POS-0002', opening_c: 0 }], ...extra });
  const TERM = { key: 'k1a2b3c4-0000-4000-8000-000000000001', id: 'k1a2b3c4-0000-4000-8000-000000000001', posId: 'BAR-1', name: 'Arka Bar', branch: 'Qendra', warehouse: 'W2' };
  const line = (sku, name, unit, qty_q, tot_c, cost_c, recipe = false) => { const vat = Math.sign(tot_c) * Math.round(Math.abs(tot_c) * 18 / 118); return { sku, name, unit, tax: 'E', rate: 18, qty_q, unit_t: Math.round((tot_c - vat) * 1e6 / qty_q), sub_c: tot_c - vat, vat_c: vat, tot_c, disc_c: 0, cost_c, recipe }; };
  const row = (id, kind, date, o) => { const items = o.items || [], tot = k => items.reduce((a, i) => a + i[k], 0), payments = (o.pays || []).map(([account, k, amount_c]) => ({ account, kind: k, amount_c })), sumK = k => payments.filter(x => x.kind === k).reduce((a, x) => a + x.amount_c, 0);
    return { id, kind, rev: 0, removed: false, date, firstTs: date + ' 08:10:00', lastTs: date + ' ' + (o.time || '21:40:00'), terminal: TERM, no: o.no || 'POS-BAR-1-' + date.replace(/-/g, '') + '-k1a2b3', status: o.status || 'Finalizuar', items,
      moves: (o.moves || []).map(([sku, qm, cost_c, type, via = null]) => ({ sku, wh: 'W2', qm, cost_c, type, via })), payments, totals: { sub_c: tot('sub_c'), vat_c: tot('vat_c'), total_c: tot('tot_c'), cash_c: sumK('cash'), card_c: sumK('card'), change_c: 0, discount_c: 0 },
      counts: o.counts || { receipts: o.n || 1, returns: 0, cancels: 0, voided: 0 }, n: o.n || 1, operators: { Ana: { count: o.n || 1, total_c: tot('tot_c'), returns_c: 0, cancels_c: 0 } }, fiscal: o.fiscal || { fiscalized: o.n || 1 }, fiscalOpen: o.fiscalOpen || [], noVat: false, ...(o.extra || {}) }; };
  const SHIFT = { id: 'S:k1a2b3:SH-1', shiftId: 'SH-1', terminal: TERM, status: 'open', opened_at: '2026-09-20 08:00:00', closed_at: null, opening_c: 5000, expected_c: null, counted_c: null, diff_c: null, operator: 'Ana', totals: { count: 3, total_c: 1600, cash_c: 1200, card_c: 400, returns_c: 0, cancels_c: 0 }, rev: 0, removed: false };
  const day20 = row('D:k1a2b3:2026-09-20', 'day', '2026-09-20', { n: 3, items: [line('KAFE', 'Kafe', 'copë', 30000, 450, 35), line('UJE', 'Ujë', 'shishe', 10000, 100, 20), line('MOJ', 'Mojito', 'gotë', 20000, 1000, 80, true), line('LIM', 'Limon', 'copë', 10000, 50, 10)],
    moves: [['KAFE', -3000, 35, 'sale'], ['UJE', -1000, 20, 'sale'], ['RUM', -80, 2000, 'sale', 'MOJ'], ['LIM', -1000, 10, 'sale']], pays: [['cash1', 'cash', 1200], ['bank1', 'card', 400]], fiscal: { fiscalized: 2, pending: 1 }, fiscalOpen: [{ id: 'rx', no: 'BAR-1/0003', ts: '2026-09-20 21:40:00', status: 'pending', error: null }] });
  const day18 = row('D:k1a2b3:2026-09-18', 'day', '2026-09-18', { n: 1, counts: { receipts: 0, returns: 1, cancels: 0, voided: 0 }, items: [line('UJE', 'Ujë', 'shishe', -50000, -500, 40)], moves: [['UJE', 5000, 40, 'sale_return']], pays: [['cash1', 'cash', -500]] });
  const biz = row('R:r-biz', 'receipt', '2026-09-20', { no: 'BAR-1/0007', time: '12:00:00', items: [line('KAFE', 'Kafe', 'copë', 40000, 600, 35)], moves: [['KAFE', -4000, 35, 'sale']], pays: [['cashGONE', 'cash', 600]], extra: { customer: 'Drini Market SH.P.K.', nui: '811234500', operator: 'Ana', origId: null, origNo: null, fiscalRef: 'TX-77' } });
  const day17 = row('D:k1a2b3:2026-09-17', 'day', '2026-09-17', { items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 35)], moves: [['KAFE', -1000, 35, 'sale']], pays: [['cash1', 'cash', 150]] });

  // ── feature off (/health without posLedger:1): a new company is seeded WITHOUT the marker, no ledger, the old /pos/sales relay
  S.features = []; mkT('t7', 'Pa Libër SH.P.K.');
  { const x = mk(); await enter(x, 'own', 't7'); await x.posSync(false); const T7 = S.T.t7;
    eq([x._ledger, 'posLedgerV' in T7.state, x.view() === x.state.db, calls('t7', /^GET \/pos\/sales/).length, calls('t7', /\/pos\/ledger/).length, x.renderVals().posLedgerBanner], [null, false, true, 1, 0, ''], 'ledger feature off: no POS ledger, the book is seeded without posLedgerV, the old /pos/sales relay runs, view() is the book');
    x.logout(); done(x); }
  S.features = ['posLedger:1'];

  // ── a company already on the ledger: t1 (Pronar A, Magazinier M), t2 for the company switch
  const T1 = mkT('t1', 'ABC SH.P.K.', book(), 'on'); T1.led.cap = 2; // two items per page → the client loops while `more`
  for (const r of [day20, day18, biz, day17]) pub(T1, JSON.parse(JSON.stringify(r))); pubShift(T1, { ...SHIFT });
  const T2 = mkT('t2', 'Drini Market SH.P.K.', book({ company: { ...book().company, name: 'Drini Market SH.P.K.' } }), 'on');
  pub(T2, row('D:k9:2026-09-19', 'day', '2026-09-19', { no: 'POS-T2-20260919', items: [line('UJE', 'Ujë', 'shishe', 20000, 200, 20)], moves: [['UJE', -2000, 20, 'sale']], pays: [['cash1', 'cash', 200]] }));
  store.removeItem('kontabo.finance.pending'); const A = mk(); S.gate = { tid: 't1', p: new Promise(r => (S.open = r)) };
  await A.apiEnter(jOf('own', 't1'), true, true); await until(() => calls('t1', /^GET \/pos\/ledger$/).length > 0);
  // while the first ledger page is still on its way: the book alone, the catalogue waits, the runtime fields stay out of the book
  { eq([!!A._ledger, A._ledger.loaded, A.view() === A.state.db, A.stockOf('KAFE'), A.renderVals().posLedgerBanner], [true, false, true, 100000, ''], 'ledger: before it loads the page shows the book alone (no POS documents yet)');
    await A.posSync(false); eq([calls('t1', /^GET \/pos\/status$/).length, calls('t1', /^PUT \/pos\/catalog$/).length, T1.tries], [1, 0, 0], 'ledger not loaded yet: terminal status only — no catalogue PUT (its stock would miss the POS sales), no commit');
    A.state.toast = null; eq([await A.posPushCatalogSrv(true), /po ngarkohet/.test(A.state.toast || '')], [null, true], '"Dërgo katalogun" waits for the ledger with a message'); }
  S.gate = null; S.open(); await until(() => A._ledger.loaded);
  { const L = A._ledger, gets = calls('t1', /^GET \/pos\/ledger$/);
    eq([L.tenantId, L.epoch, L.rev, L.rows.size, L.shifts.size, L.mode, L.ready, gets.map(g => qsOf(g.path).since + '/' + qsOf(g.path).limit)], ['t1', 'E-t1', T1.led.top, 4, 1, 'on', true, ['0/200', '2/200', '4/200']], 'ledger: GET /pos/ledger?since=&limit=200 loops while `more` (server cap 2 → 3 pages), rows + shifts in memory');
    eq([S.timeouts.length > 0 && S.timeouts.every(t => t === '/pos/ledger 30000'), S.noHdr], [true, []], 'ledger calls use the 30 s timeout; every call carries X-Kontabo-Client: 2');
    eq(await A.apiFetch('/hang', { timeout: 600 }).then(() => 'resolved', e => e.message), 'Serveri nuk u përgjigj (1 s)', 'apiFetch: a per-call timeout aborts the request and names the seconds'); A.apiStatus('online', '');
    const v = A.view(), docs = v.posReceipts.filter(r => r._srv), mv = v.movements.filter(m => m._srv), pays = v.payments.filter(p => p._srv);
    eq([docs.map(r => [r.id, r.summary, r.n]), mv.length, pays.length, v.posShifts.filter(s => s._srv).length, A.state.db.posReceipts.length, A.state.db.movements.length], [[['D:k1a2b3:2026-09-20', true, 3], ['R:r-biz', false, 1], ['D:k1a2b3:2026-09-18', true, 1], ['D:k1a2b3:2026-09-17', true, 1]], 7, 5, 1, 0, 0], 'view(): derived documents (newest first), movements, payments and the shift — the book itself stays empty');
    const d20 = docs[0], b = docs[1];
    eq([d20.kind, d20.no, d20.pos, d20.posName, d20.branch, d20.operator, d20.date, d20.time, d20.customer, d20.nui, d20.total, d20.cash_c, d20.card_c, d20.fiscal, d20.fiscalOpen.length, d20.items.map(i => [i.sku, i.qty, i.unit_c, i.tot, i.recipe])],
      ['Kupon POS', day20.no, 'BAR-1', 'Arka Bar', 'Qendra', '—', '20.09.2026', '21:40', 'Klient me shumicë', '—', 1600, 1200, 400, 'Në pritje', 1, [['KAFE', 3, 127, 450, false], ['UJE', 1, 85, 100, false], ['MOJ', 2, 424, 1000, true], ['LIM', 1, 42, 50, false]]], 'derived day document: summary of the terminal-day, items in the ERP shape, the worst fiscal state');
    eq([b.customer, b.nui, b.operator, b.fiscalRef, b.summary], ['Drini Market SH.P.K.', '811234500', 'Ana', 'TX-77', false], 'derived receipt document (buyer NUI): customer, NUI, operator, fiscal reference');
    eq(mv.filter(m => m.docId === day20.id).map(m => [m.type, m.sku, m.qm, m.wh, m.unit_c, m.via, m.ref, m.note]), [['sale', 'KAFE', -3000, 'W2', 35, null, day20.no, 'POS · përmbledhje ditore'], ['sale', 'UJE', -1000, 'W2', 20, null, day20.no, 'POS · përmbledhje ditore'], ['sale', 'RUM', -80, 'W2', 2000, 'MOJ', day20.no, 'POS · përmbledhje ditore'], ['sale', 'LIM', -1000, 'W2', 10, null, day20.no, 'POS · përmbledhje ditore']], 'derived movements: the server\'s type, frozen cost, warehouse and `via`, ref = row no, docId = row id');
    eq(pays.map(p => [p.no, p.dir, p.amount_c, p.account, p.method, p.ref]), [['POS-20260920-k1a2b3', 'in', 1200, 'cash1', 'Arkë', day20.no], ['POS-20260920-k1a2b3K', 'in', 400, 'bank1', 'Bankë', day20.no], ['POS-BAR-1/0007', 'in', 600, 'cash1', 'Arkë', 'BAR-1/0007'], ['POS-20260918-k1a2b3', 'out', 500, 'cash1', 'Arkë', day18.no], ['POS-20260917-k1a2b3', 'in', 150, 'cash1', 'Arkë', day17.no]], 'derived payments: frozen accounts; a frozen account the book no longer has → the till\'s cash account (cashGONE → cash1)');
    eq([A.stockOf('KAFE'), A.stockOf('UJE'), A.stockOf('RUM'), A.stockOf('LIM'), A.stockOfWh('KAFE', 'W1'), A.stockOfWh('KAFE', 'W2'), A.stockOfWh('RUM', 'W2'), A.accountBalance('cash1'), A.accountBalance('bank1')], [92000, 9000, 9920, -1000, 100000, -8000, -80, 1450, 400], 'stockOf / stockOfWh / accountBalance read the book + the ledger');
    eq([A.avgCost(A.view(), 'UJE'), A.avgCost(A.state.db, 'UJE'), A.avgCost(A.view(), 'KAFE')], [20, 20, 30], 'avgCost is unchanged by `_srv` rows (the 5 bottles returned at a frozen 0.40 never move the average)');
    const sh = v.posShifts[0]; eq([sh.id, sh.pos, sh.posName, sh.status, sh.opening_c, sh.totals.total_c, sh._srv], ['SH-1', 'BAR-1', 'Arka Bar', 'Hapur', 5000, 1600, 1], 'derived shift with its totals'); }
  // tombstones, journal, reports
  tomb(T1, day17.id); await A.ledgerTick();
  { const v = A.view(); eq([A._ledger.rows.size, v.posReceipts.some(r => r.id === day17.id), v.movements.some(m => m.docId === day17.id), A.stockOf('KAFE'), A.accountBalance('cash1')], [3, false, false, 93000, 1300], 'a tombstone drops the row: its document, movements and payments are gone'); }
  { const J = A.journal(), dr = J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[1], 0), 0), cr = J.reduce((a, e) => a + e.lines.reduce((x, l) => x + l[2], 0), 0), of = (ref, re) => (J.find(e => e.ref === ref && re.test(e.desc)) || {}).lines;
    eq(dr === cr, true, 'journal balanced with the derived POS documents (' + J.length + ' entries)');
    eq([of(day20.no, /^Përmbledhje ditore POS/), of(day20.no, /^Kosto e mallit/)], [[['1000', 1200, 0], ['1010', 400, 0], ['4000', 0, day20.totals.sub_c], ['2400', 0, day20.totals.vat_c]], [['5000', 295, 0], ['1300', 0, 295]]], 'journal: a day summary posts cash/card, revenue, VAT and its COGS by docId (105 + 20 + 160 recipe + 10)');
    eq([of(day18.no, /^Përmbledhje ditore POS/), of(day18.no, /^Kthim malli/)], [[['1000', 0, 500], ['4000', 424, 0], ['2400', 76, 0]], [['1300', 200, 0], ['5000', 0, 200]]], 'journal: a return-only day posts 4000 and 2400 by their own sign, the goods back at the frozen cost');
    eq(of('BAR-1/0007', /^Kosto e mallit/), [['5000', 140, 0], ['1300', 0, 140]], 'journal: a receipt row\'s COGS from its own movements (docId)'); }
  { const sd = A.salesDocs().filter(r => r.src === 'pos'); eq([sd.map(r => r.n), sd.reduce((a, r) => a + r.total, 0)], [[3, 1, 1], 1700], 'salesDocs: POS documents carry n (receipts they stand for)');
    A.state.admin = false; A.state.section = 'dashboard'; A.state.page = 'Paneli'; A.state.range = 'Gjithçka'; eq(/5 kupona POS/.test(A.renderVals().kpis[0].sub), true, 'dashboard: "5 kupona POS" counts the receipts, not the documents');
    A.state.rp = 'all'; A.state.rTab = 'Përmbledhje'; const tv = A.pageTable('R:TVSH'); eq([tv.rows[0].cells[1].t, tv.kpis[0].sub], ['5', '5 fatura'], 'R:TVSH: document counts sum n');
    A.state.rTab = 'Sipas klientit'; const ts = A.pageTable('R:Shitje'); eq([ts.count, ts.kpis[3].value], ['5', A.fmt(340)], 'R:Shitje: count and the average per document use n (17.00 / 5)');
    A.state.rTab = 'Sipas artikullit'; const ta = A.pageTable('R:Shitje'), costOf = sku => ((ta.rows.find(r => r.cells[1].t === sku) || { cells: [] }).cells[4] || {}).t;
    eq([costOf('KAFE'), costOf('UJE'), costOf('MOJ'), costOf('LIM')], [A.fmt(245), A.fmt(-180), A.fmt(160), A.fmt(10)], 'R:Shitje by article: cost per document by docId (a return-only day nets negative; the recipe via its ingredients)'); A.state.rTab = ''; A.state.rp = 'month'; }
  // the catalogue: only once loaded, only when its hash changed, runtime fields in memory + per-company localStorage, never in the book
  { await A.posSync(false); await A.posSync(false); const cat = T1.catalogs[0] || { products: [] }, kafe = cat.products.find(p => p.sku === 'KAFE') || {}, moj = cat.products.find(p => p.sku === 'MOJ') || {};
    eq([T1.catalogs.length, kafe.stock_qm, kafe.stock_by_wh, moj.stock_qm, A.posCfg().catalogVersionSrv, !!A.posCfg().catalogHashSrv, A.state.db.posSync.catalogHashSrv, T1.state.posSync.catalogHashSrv, JSON.parse(store.getItem('kontabo.finance.posrt.t1')).catalogVersionSrv],
      [1, 93000, { W1: 100000, W2: -7000 }, Math.floor(9920 / 40) * 1000, 1, true, '', '', 1], 'catalogue PUT once after the ledger loaded (stock = book + ledger), not again while unchanged; runtime fields in memory + localStorage, never in the book');
    A.updateProduct('KAFE', { price_c: 350 }); await until(() => !(A._pending || []).length); await A.posSync(false); eq(T1.catalogs.length, 2, 'catalogue: a changed hash is PUT again');
    eq([calls('t1', /^(GET \/pos\/sales|POST \/pos\/ack)$/).length, T1.commits.length, T1.commits.every(p => Object.keys(p).join() === 'products,categories')], [0, 1, true], 'ledger mode: never /pos/sales or /pos/ack; the only commit was the product change'); }
  { const n0 = T1.tries; await A.ledgerTick(); await A.posSync(false); await A.ledgerTick(); await A.posSync(true); eq(T1.tries - n0, 0, 'ticks of the owner (ledger + POS sync, timer and manual) commit nothing'); }
  // memo: view() and its arrays stay the same objects between ticks that bring nothing new
  { const v1 = A.view(); await A.ledgerTick(); const v2 = A.view(); A.setState(s => ({ db: { ...s.db, notifRead: { x: 1 } } })); const v3 = A.view();
    eq([v1 === v2, v3 === v1, v3.movements === v1.movements, v3.payments === v1.payments, v3.posReceipts === v1.posReceipts, A.mvIndex(v3) === A.mvIndex(v1)], [true, false, true, true, true, true], 'view(): memoised on the book and the ledger version — derived arrays (and the movement index) survive unrelated book changes');
    const m1 = { type: 'adjust', sku: 'KAFE', qm: -1000, unit_c: 30, date: '20.09.2026' }, m2 = { ...m1, qm: -2000 }, b2 = { ...A.state.db, movements: [m1] }; const w1 = A.view(b2); b2.movements = [m2]; const w2 = A.view(b2);
    eq([w1.movements[0] === m1, w2.movements[0] === m2, A.stockOf('KAFE', w2), w2.posReceipts === w1.posReceipts], [true, true, 93000 - 2000, true], 'view(): a book array replaced in place (same length) is not served stale'); }
  // every page and the drawer of every derived document render in ledger mode (summary documents included)
  { const errs = []; for (const n of A.NAV) for (const pg of n.items) { A.state.admin = false; A.state.section = n.id; A.state.page = pg; try { A.renderVals(); } catch (e) { errs.push(n.id + '/' + pg + ': ' + e.message); } }
    for (const r of A.view().posReceipts.filter(x => x._srv)) { try { A.openDr('pos', r.id); A.drawerVals(); A.renderVals(); } catch (e) { errs.push('drawer ' + r.id + ': ' + e.message); } }
    for (const p of A.view().payments.filter(x => x._srv)) { try { A.state.section = 'finance'; A.state.page = 'Pagesa'; const t = A.pageTable('Pagesa'); const rw = t.rows.find(x => JSON.stringify(x.cells).includes(p.no)); if (rw && rw.open) rw.open(); A.drawerVals(); A.renderVals(); } catch (e) { errs.push('payment ' + p.no + ': ' + e.message); } }
    A.state.dr = null; A.state.drawer = null; A.state.section = 'dashboard'; A.state.page = 'Paneli';
    eq(errs, [], 'ledger mode: every page, the drawer of every derived document and its payments render without throwing'); }
  // validation helpers and the stock count see the ledger's movements
  { const lim = A.prodOf(A.state.db, 'LIM'); eq([A.unitLocked(A.state.db, lim), A.unitLocked(A.view(), lim)], [false, true], 'unitLocked: LIM has no book movement, but the ledger sold it');
    A.state.toast = null; eq([A.updateProduct('LIM', { unit: 'kg' }), /Njësia nuk ndryshohet/.test(A.state.toast || '')], [false, true], 'updateProduct: the unit of a product the tills sold is locked (view)');
    A.state.toast = null; eq([A.updateProduct('LIM', { recipe: [{ sku: 'RUM', qm: 10 }] }), /stok ose lëvizje/.test(A.state.toast || '')], [false, true], 'updateProduct: a product with ledger movements cannot become a recipe');
    A.openProduct('LIM'); A.drawerVals().actions[0].go(); const f = A.formVals().fields; eq([f.some(x => x.key === 'unit'), f.some(x => x.label === 'Njësia' && x.isInfo)], [false, true], 'product form: the unit is an info field (locked by ledger movements)'); A.state.frm = null; A.state.dr = null;
    A.adjustStock({ sku: 'KAFE', counted_qm: 90000, note: '', date: '20.09.2026' }); await until(() => !(A._pending || []).length);
    const adj = T1.state.movements[T1.state.movements.length - 1]; eq([adj.type, adj.qm, A.stockOf('KAFE'), '_srv' in adj], ['adjust', -3000, 90000, false], 'adjustStock counts against book + ledger (93 → 90: −3), commits a plain book movement'); }
  // a 409 reload keeps the view (the server book carries posLedgerV) and the reconcile finds nothing to remove
  { T1.version++; T1.state.company = { ...T1.state.company, name: 'ABC (server)' }; const n0 = T1.tries;
    A.addParty('customer', { name: 'Klient 409', type: 'Biznes', nui: '—', fiscal: '—', city: '—', contact: '—', address: '—' }); await until(() => A.state.db.company.name === 'ABC (server)' && !(A._pending || []).length && !A._flushing); await wait(20);
    eq([A.state.db.company.name, A.state.db.posLedgerV, A.view().posReceipts.filter(r => r._srv).length, A.stockOf('KAFE'), T1.tries - n0, A.state.db.customers.some(x => x.name === 'Klient 409')], ['ABC (server)', 1, 3, 90000, 1, false], '409: the server book wins, the POS ledger stays in view, nothing to reconcile (no extra commit)'); }
  // a member without the POS permission: reads the ledger, never touches the terminals, the catalogue or the book
  const M = mk(); await enter(M, 'mag', 't1');
  { const n0 = T1.tries, st0 = calls('t1', /^GET \/pos\/status$/).length, put0 = T1.catalogs.length; await M.ledgerTick(); await M.posSync(false); await M.posSync(true); await M.ledgerTick();
    eq([M._ledger.loaded, M.view().posReceipts.filter(r => r._srv).length, M.stockOf('KAFE'), T1.tries - n0, calls('t1', /^GET \/pos\/status$/).length - st0, T1.catalogs.length - put0, S.calls.filter(x => x.who === 'mag' && /activate|known|reset/.test(x.p)).length, M.renderVals().posLedgerBanner], [true, 3, 90000, 0, 0, 0, 0, ''], 'no POS permission: the ledger is read (every member), no /pos/status, no catalogue, no commit from any tick');
    M.logout(); await wait(); eq(M._ledger, null, 'logout clears the ledger'); done(M); }
  // switching the company drops a ledger response that was still on its way
  { const X = mk(); await enter(X, 'own', 't1'); eq(X._ledger.rows.size, 3, 'company switch: the first company\'s ledger is loaded');
    S.gate = { tid: 't1', p: new Promise(r => (S.open = r)) }; const late = X.ledgerTick(); // a tick still in flight for t1
    await X.apiSwitchTenant('t2'); await until(() => X._ledger && X._ledger.tenantId === 't2' && X._ledger.loaded);
    pub(T1, JSON.parse(JSON.stringify(day17))); S.gate = null; S.open(); await late; await wait(20); // the late answer carries a new t1 row
    eq([X._ledger.tenantId, X._ledger.epoch, [...X._ledger.rows.keys()], X.view().posReceipts.filter(r => r._srv).map(r => r.no), X.stockOf('UJE'), X.apiCfg().tenantId], ['t2', 'E-t2', ['D:k9:2026-09-19'], ['POS-T2-20260919'], 3000, 't2'], 'company switch: the ledger is reset, the late answer of the old company is dropped');
    X.logout(); done(X); }
  // the server's ledger was emptied or rebuilt elsewhere: a new epoch (or a cursor ahead of the server) → refetch from 0
  { const before = A._ledger.rev; T1.led.epoch = 'E-t1-new'; T1.led.rows = new Map(); T1.led.shifts = new Map(); T1.led.top = 50; pub(T1, JSON.parse(JSON.stringify(day20)));
    await A.ledgerTick(); eq([A._ledger.epoch, [...A._ledger.rows.keys()], A._ledger.shifts.size, A._ledger.rev, A.stockOf('KAFE'), calls('t1', /^GET \/pos\/ledger$/).slice(-2).map(g => qsOf(g.path).since)], ['E-t1-new', [day20.id], 0, 51, 94000, [String(before), '0']], 'epoch change → reset and refetch from 0 (rows of the old epoch gone)');
    T1.led.rows = new Map(); T1.led.top = 0; pub(T1, JSON.parse(JSON.stringify(day18)));
    await A.ledgerTick(); eq([[...A._ledger.rows.keys()], A._ledger.rev, calls('t1', /^GET \/pos\/ledger$/).slice(-2).map(g => qsOf(g.path).since)], [[day18.id], 1, ['51', '0']], 'a cursor ahead of the server (rev < since) → refetch from 0'); }
  // "Zbraz librat": the owner empties the book AND the server's POS ledger (new epoch), the page refetches from 0
  { pub(T1, JSON.parse(JSON.stringify(day20))); await A.ledgerTick(); eq(A._ledger.rows.size, 2, 'before "Zbraz librat": two ledger rows');
    const k0 = S.calls.length; A.resetDemo(); await until(() => T1.resets === 1 && A._ledger && A._ledger.loaded && A._ledger.epoch === T1.led.epoch);
    const seq = S.calls.slice(k0).filter(x => x.tid === 't1' && /^(PUT \/state|POST \/pos\/ledger\/reset|GET \/pos\/ledger)$/.test(x.m + ' ' + x.p)).map(x => x.m + ' ' + x.p);
    eq([seq.slice(0, 3), T1.state.posLedgerV, T1.state.products.length, A._ledger.rows.size, A._ledger.rev > 0, A.view().posReceipts.length, /libri i POS-it u zbraz/.test(A.state.toast || '')], [['PUT /state', 'POST /pos/ledger/reset', 'GET /pos/ledger'], 1, 0, 0, true, 0, true], '"Zbraz librat": PUT /state (seed with posLedgerV 1) → POST /pos/ledger/reset → the ledger from 0 (tombstones only)'); }
  A.logout(); done(A);

  // ── a new company on the ledger: seeded with posLedgerV 1; the ledger is switched on ONCE, by a user with the POS permission
  const T6 = mkT('t6', 'Firma e Re SH.P.K.');
  { const K = mk(); await enter(K, 'mag', 't6'); await K.ledgerTick(); await K.ledgerTick();
    eq([T6.state.posLedgerV, T6.activates.length, T6.led.mode], [1, 0, 'off'], 'new company: the seed carries posLedgerV 1; a member without the POS permission never switches the ledger on'); K.logout(); done(K);
    const O = mk(); await enter(O, 'kas', 't6'); await until(() => T6.activates.length > 0); await O.ledgerTick(); await O.ledgerTick(); await wait(20);
    eq([T6.activates, T6.led.mode, O._ledger.mode, T6.commits.length], [[{ done: true }], 'on', 'on', 0], 'new company: POST /pos/ledger/activate {done:true} exactly once (POS permission), no commit'); O.logout(); done(O); }

  // ── migration of an old book (POS receipts imported by the old relay) — end to end
  const legacyBook = () => { const loc = new C({}); loc._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' };
    const { posLedgerV, ...b0 } = book(); loc.state.db = { ...b0, terminals: [{ id: 'k1', name: 'Arka Bar', branch: 'Qendra', posId: 'BAR-1', warehouse: 'W2', status: 'Aktiv' }] };
    const li = (sku, name, unit, qty_m, tot_c) => { const vat = Math.sign(tot_c) * Math.round(Math.abs(tot_c) * 18 / 118); return { sku, name, unit, qty_m, unit_c: Math.round(Math.abs((tot_c - vat) * 1000 / qty_m)), rate: 18, tax: 'E', disc_bp: 0, sub_c: tot_c - vat, vat_c: vat, tot_c }; };
    const R = (id, no, status, items, cash, card, extra = {}) => ({ id, no, shift_id: 'SH-1', pos_id: 'BAR-1', pos_name: 'Arka Bar', branch: 'Qendra', operator: 'Ana', ts: '2026-09-10 10:00:00', customer: 'Klient me shumicë', customer_nui: '', sub_c: items.reduce((a, i) => a + i.sub_c, 0), vat_c: items.reduce((a, i) => a + i.vat_c, 0), total_c: items.reduce((a, i) => a + i.tot_c, 0), cash_c: cash, card_c: card, change_c: 0, status, fiscal_status: 'fiscalized', fiscal_ref: 'TX', fiscal_mode: 'ATK_ELECTRONIC', fiscal_error: '', orig_id: null, items, ...extra });
    loc.importPosSales([R('rA', 'BAR-1/0001', 'final', [li('KAFE', 'Kafe', 'copë', 2000, 300)], 300, 0), R('rB', 'BAR-1/0002', 'final', [li('UJE', 'Ujë', 'shishe', 1000, 100)], 0, 100), R('rC', 'BAR-1/0003', 'return', [li('KAFE', 'Kafe', 'copë', -1000, -150)], -150, 0, { orig_id: 'rA', orig_no: 'BAR-1/0001' }), R('rL', 'BAR-1/0004', 'final', [li('KAFE', 'Kafe', 'copë', 1000, 150)], 150, 0, { shift_id: 'SH-OLD' })],
      [{ id: 'SH-1', pos_id: 'BAR-1', pos_name: 'Arka Bar', branch: 'Qendra', operator: 'Ana', opened_at: '2026-09-10 08:00:00', closed_at: null, opening_c: 5000, status: 'open' }, { id: 'SH-OLD', pos_id: 'BAR-1', pos_name: 'Arka Bar', branch: 'Qendra', operator: 'Ana', opened_at: '2026-08-01 08:00:00', closed_at: '2026-08-01 20:00:00', opening_c: 0, status: 'closed' }]);
    clearTimeout(loc._t); const out = JSON.parse(JSON.stringify(loc.state.db)); delete out.terminals; return out; };
  const mig = (id) => { const T = mkT(id, 'Kafe Bar ' + id + ' SH.P.K.', legacyBook(), 'off'); T.known = new Set(['rA', 'rB', 'rC']); T.knownShifts = new Set(['SH-1']); T.led.notReady = 2; T.notReadyAfterDone = 1;
    pub(T, row('D:k1a2b3:2026-09-10', 'day', '2026-09-10', { n: 3, counts: { receipts: 2, returns: 1, cancels: 0, voided: 0 }, items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 30), line('UJE', 'Ujë', 'shishe', 10000, 100, 20)], moves: [['KAFE', -1000, 30, 'sale'], ['UJE', -1000, 20, 'sale']], pays: [['cash1', 'cash', 150], ['bank1', 'card', 100]] }));
    pub(T, row('D:k1a2b3:2026-09-11', 'day', '2026-09-11', { items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 30)], moves: [['KAFE', -1000, 30, 'sale']], pays: [['cash1', 'cash', 150]] })); // a receipt that never reached the old book
    pubShift(T, { ...SHIFT, id: 'S:k1a2b3:SH-1', opened_at: '2026-09-10 08:00:00', totals: { count: 3, total_c: 250, cash_c: 150, card_c: 100, returns_c: 150, cancels_c: 0 } }); return T; };
  const T3 = mig('t3'), st3 = JSON.parse(JSON.stringify(T3.state));
  eq([st3.posReceipts.map(r => r.id), st3.posShifts.map(s => s.id), st3.movements.length, st3.payments.filter(p => p.kind === 'pos').length, st3.queue.length], [['rL', 'rC', 'rB', 'rA'], ['SH-OLD', 'SH-1'], 4, 4, 4], 'migration fixture: an old book with 4 imported receipts (3 known to the server, 1 legacy) and 2 shifts');
  // a member without the POS permission comes first: banner, the old book alone (no double counting), no migration calls, no commit
  const M3 = mk(); await enter(M3, 'mag', 't3');
  const K0 = M3.stockOf('KAFE'), C0 = M3.accountBalance('cash1'), B0 = M3.accountBalance('bank1'), U0 = M3.stockOf('UJE');
  eq([K0, C0, B0, U0, M3.view() === M3.state.db, /pret kalimin te libri i ri i POS-it/.test(M3.renderVals().posLedgerBanner), T3.knownCalls.length + T3.activates.length, T3.tries], [98000, 300, 100, 4000, true, true, 0, 0], 'not migrated + no POS permission: banner, book-only view, no known/activate, no commit');
  // the owner opens the ERP: flush → ready → known → activate (the book\'s own frozen values) → done → ready → ONE commit
  S.mid = []; T3.onActivate = () => S.mid.push([P3.stockOf('KAFE'), P3.accountBalance('cash1'), P3.view() === P3.state.db]); T3.onKnown = () => S.mid.push([P3.stockOf('KAFE'), P3.accountBalance('cash1'), P3.view() === P3.state.db]);
  const P3 = mk(); await enter(P3, 'own', 't3'); await until(() => P3.state.db.posLedgerV === 1 && T3.state.posLedgerV === 1 && !P3._migrating);
  { const known = st3.posReceipts.filter(r => T3.known.has(r.id)), mvOf = no => st3.movements.find(m => m.ref === no);
    eq(T3.knownCalls, [{ ids: st3.posReceipts.map(r => r.id), shiftIds: st3.posShifts.map(s => s.id) }], 'migration: POST /pos/receipts/known with the book\'s receipt and shift ids');
    eq(T3.activates, [{ receipts: [{ id: 'rC', costs: { KAFE: mvOf('BAR-1/0003').unit_c }, noVat: false, wh: 'W2', cash: 'cash1' }, { id: 'rB', costs: { UJE: 20 }, noVat: false, wh: 'W2', card: 'bank1' }, { id: 'rA', costs: { KAFE: 30 }, noVat: false, wh: 'W2', cash: 'cash1' }] }, { done: true }], 'migration: activate with the book\'s frozen cost per sku, no-VAT rule, warehouse and cash/card accounts, then {done:true}');
    eq([known.length, S.mid], [3, [[K0, C0, true], [K0, C0, true], [K0, C0, true]]], 'migration: at known, at activate and at done the page still shows the old book alone (no double counting)');
    eq([T3.commits.length, Object.keys(T3.commits[0]).sort()], [1, ['movements', 'payments', 'posLedgerV', 'posLegacyNos', 'posLegacyShifts', 'posReceipts', 'posShifts', 'queue']], 'migration: ONE commit');
    const s = T3.state; eq([s.posLedgerV, s.posLegacyNos, s.posLegacyShifts, s.posReceipts.map(r => r.id), s.posShifts.map(x => x.id), s.movements.map(m => m.ref), s.payments.filter(p => p.kind === 'pos').map(p => p.ref), s.queue.map(q => q.ref)], [1, ['BAR-1/0004'], ['SH-OLD'], ['rL'], ['SH-OLD'], ['BAR-1/0004'], ['BAR-1/0004'], ['BAR-1/0004']], 'migration: the known receipts leave the book with their movements, payments, queue rows and shifts; the legacy one stays');
    eq([P3.stockOf('KAFE'), P3.accountBalance('cash1'), P3.accountBalance('bank1'), P3.stockOf('UJE')], [K0 - 1000, C0 + 150, B0, U0], 'migration: no double counting — the same totals as before, plus only the receipt that never reached the old book');
    eq([P3.state.confirm && P3.state.confirm.title, ((P3.state.confirm || {}).body || '').includes('Shtator 2026: ' + P3.fmt(250) + ' → ' + P3.fmt(400) + ' (+' + P3.fmt(150) + ')')], ['Libri i POS-it kaloi në server', true], 'migration: a one-time dialog with the per-month difference (old book → server ledger)');
    eq(T3.audit.filter(a => /^Libri i POS-it kaloi në server: 3 kupona dhe 1 ndërrime u hoqën/.test(a)).length, 1, 'migration: audit line');
    const k0 = S.calls.length; eq([await P3.posLedgerMigrate(), S.calls.slice(k0).filter(x => /known|activate|commit/.test(x.p)).length, T3.commits.length], [true, 0, 1], 'migration: idempotent — a rerun does nothing');
    await M3.apiReloadState(); await wait(20); eq([M3.renderVals().posLedgerBanner, M3.stockOf('KAFE'), M3.accountBalance('cash1'), T3.commits.length], ['', K0 - 1000, C0 + 150, 1], 'the member without the POS permission reloads: the ledger is in view, banner gone, nothing to reconcile');
    P3.logout(); M3.logout(); done(P3); done(M3); }
  // the migration commit loses a race (409): the server book wins, the migration runs again and commits once
  const T4 = mig('t4'); T4.onCommit = patch => { if ('posLedgerV' in patch && !T4.raced) { T4.raced = true; T4.version++; T4.state = { ...T4.state, company: { ...T4.state.company, phone: '+383 49 000 000' } }; return json(409, { error: 'version_conflict', version: T4.version, state: T4.state }); } return null; };
  { const P4 = mk(); await enter(P4, 'kas', 't4'); await until(() => T4.state.posLedgerV === 1 && !P4._migrating);
    eq([T4.raced, T4.knownCalls.length, T4.activates.filter(a => a.done).length, T4.commits.length, T4.state.posLegacyNos, P4.state.db.company.phone, P4.stockOf('KAFE'), P4.accountBalance('cash1')], [true, 2, 2, 1, ['BAR-1/0004'], '+383 49 000 000', 97000, 450], 'migration after a 409: the server book is reloaded, the whole migration runs again (idempotent), one commit lands, no double counting');
    P4.logout(); done(P4); }

  // the server refuses the migration commit (4xx): the local copy had already dropped the rows → the server's book is reloaded, retried later
  const T8 = mig('t8'); T8.onCommit = patch => { if ('posLedgerV' in patch && !T8.refused) { T8.refused = true; return json(413, { error: 'payload_too_large', message: 'Kërkesa është shumë e madhe' }); } return null; };
  { const P8 = mk(); await enter(P8, 'own', 't8'); await until(() => T8.refused && !P8._migrating && P8.state.db.posReceipts.length === 4);
    eq([P8.state.db.posLedgerV, P8.state.db.posReceipts.length, P8.view() === P8.state.db, P8.stockOf('KAFE'), P8.accountBalance('cash1'), /Kalimi te libri i ri i POS-it dështoi: serveri e refuzoi/.test(P8.state.toast || ''), T8.commits.length, P8._migFail > 0], [undefined, 4, true, 98000, 300, true, 0, true], 'migration refused by the server: the book is reloaded (rows back, book-only view, no double counting), retried later');
    P8._migFail = 0; P8.posLedgerAfterTick(); await until(() => T8.state.posLedgerV === 1 && !P8._migrating);
    eq([T8.commits.length, T8.state.posLegacyNos, P8.stockOf('KAFE'), P8.accountBalance('cash1')], [1, ['BAR-1/0004'], 97000, 450], 'migration retried after the back-off: one commit, no double counting');
    P8.logout(); done(P8); }

  // ── reconcile on load + replayed unsent patches: a book on the ledger never keeps POS rows that are not legacy
  const st5 = book({ posLegacyNos: ['L-1'], posLegacyShifts: ['S-L'],
    posReceipts: [{ id: 'l1', no: 'L-1', kind: 'Kupon POS', status: 'Finalizuar', date: '01.08.2026', total: 100, items: [] }, { id: 'x9', no: 'X-9', kind: 'Kupon POS', status: 'Finalizuar', date: '20.09.2026', total: 150, items: [] }], posShifts: [{ id: 'S-L' }, { id: 'S-X' }],
    payments: [{ no: 'POS-1', kind: 'pos', ref: 'L-1', dir: 'in', amount_c: 100, account: 'cash1', date: '01.08.2026' }, { no: 'POS-9', kind: 'pos', ref: 'X-9', dir: 'in', amount_c: 150, account: 'cash1', date: '20.09.2026' }, { no: 'PAG-1', kind: 'sale', ref: 'FSH-1', dir: 'in', amount_c: 50, account: 'bank1', date: '20.09.2026' }],
    movements: [{ type: 'sale', sku: 'KAFE', qm: -1000, ref: 'L-1', note: 'Kupon POS', unit_c: 30, date: '01.08.2026' }, { type: 'sale', sku: 'KAFE', qm: -1000, ref: 'X-9', note: 'Kupon POS', unit_c: 30, date: '20.09.2026' }, { type: 'sale_cancel', sku: 'KAFE', qm: 1000, ref: 'X-10', note: 'Anulim kuponi POS X-9', unit_c: 30, date: '20.09.2026' }, { type: 'sale', sku: 'UJE', qm: -1000, ref: 'FSH-1', note: '', unit_c: 20, date: '20.09.2026' }],
    queue: [{ ref: 'X-9', kind: 'Kupon POS', pos: 'Arka Bar · Qendra' }, { ref: 'L-1', kind: 'Kthim', pos: 'Arka Bar · Qendra' }, { ref: 'FSH-1', kind: 'Anulim', pos: 'ERP · Fiscal Agent Prishtinë' }, { ref: 'X-10', kind: 'Anulim', pos: 'Arka Bar · Qendra' }] });
  const T5 = mkT('t5', 'Rakordim SH.P.K.', st5, 'on');
  { const P5 = mk(); store.setItem('kontabo.finance.pending', JSON.stringify([{ posReceipts: [...st5.posReceipts, { id: 'x11', no: 'X-11' }] }, { customers: [{ name: 'Klient i ridërguar', type: 'Biznes', nui: '—', fiscal: '—', city: '—', contact: '—', address: '—' }] }]));
    await P5.apiEnter(jOf('own', 't5'), true, false); const toast = P5.state.toast || '';
    await until(() => T5.commits.length >= 2 && !(P5._pending || []).length); await wait(20);
    eq([/1 ndryshim me kuponë POS u hodh/.test(toast), /1 ndryshime të pa-dërguara/.test(toast), JSON.parse(store.getItem('kontabo.finance.pending') || '[]').some(p => 'posReceipts' in p)], [true, true, false], 'replayed unsent patches: the one carrying posReceipts is dropped (toast), the other is sent');
    eq(T5.commits.map(p => Object.keys(p).sort().join()).sort(), ['customers', 'movements,payments,posReceipts,posShifts,queue'], 'reconcile: ONE commit removing the non-legacy POS rows (plus the replayed customer)');
    const s = T5.state; eq([s.posReceipts.map(r => r.no), s.posShifts.map(x => x.id), s.payments.map(p => p.ref), s.movements.map(m => m.ref), s.queue.map(q => q.ref), s.customers.map(x => x.name)], [['L-1'], ['S-L'], ['L-1', 'FSH-1'], ['L-1', 'FSH-1'], ['L-1', 'FSH-1'], ['Klient i ridërguar']], 'reconcile: legacy receipts, ERP invoices and their fiscal rows stay; stray POS rows go');
    const Q = mk(); const n0 = T5.tries; await enter(Q, 'mag', 't5'); await wait(20); eq(T5.tries - n0, 0, 'reconcile: a clean book → no commit on the next load');
    P5.logout(); Q.logout(); done(P5); done(Q); }

  eq(S.bad, [], 'mock server: no commit ever carried `_srv` rows or posSync runtime fields');
  eq(S.noHdr, [], 'mock server: every request carried X-Kontabo-Client: 2');
  return { S, users, mkT, pub, pubShift, calls, json, mk, enter, done, wait, until, store, book, TERM, line, row, SHIFT, legacyBook }; // for the E-L2 block below
}).catch(e => { console.log('FAIL POS ledger tests threw: ' + (e && e.stack || e)); process.exitCode = 1; })
// ══ Faza B · E-L2 (API mode, POS ledger): the server's receipts one by one (GET /pos/receipts[/{id}]) on P:Shitje / P:Kthime / the fiscal monitor
// and in the receipt drawer, the day-summary drawer, the pages derived from the ledger rows, the A4 invoice from a server receipt, the server's
// API keys and the terminal token rotation; ensurePins stable; feature-off / local mode as before. Runs after the ledger block (same mock server). ══
  .then(async (H) => { if (!H) { console.log('FAIL E-L2 tests skipped: the POS ledger block did not finish'); process.exitCode = 1; return; }
    const { S, users, mkT, pub, pubShift, calls, mk, enter, done, wait, until, store, book, TERM, line, row, SHIFT, legacyBook } = H;
    const defer = () => { let open; const p = new Promise(r => (open = r)); return { p, open }; };
    // the runtime calls componentDidUpdate after every state change (batched, after the render): emulated with a microtask per burst
    const mkR = () => { const x = mk(), set = x.setState.bind(x); let q = false; x.setState = u => { set(u); if (!q) { q = true; Promise.resolve().then(() => { q = false; x.componentDidUpdate(); }); } }; return x; };
    const idle = x => { const s = x.state; return !x._plT && !(s.posList && s.posList.busy) && !(s.posRc && s.posRc.busy) && !(s.apiKeysSrv && s.apiKeysSrv.busy); };
    const settle = async x => { await wait(); await until(() => idle(x)); await wait(); };
    const rcOf = (tid, k0) => S.calls.slice(k0).filter(x => x.tid === tid && /^\/pos\/receipts(\/|$)/.test(x.p) && x.p !== '/pos/receipts/known').map(x => x.m + ' ' + x.path);
    const cellsT = r => r.cells.map(c => c.t), lab = list => (list || []).map(a => a.label);
    // ── receipts as kontabo-backend's receipt_items() returns them: the till's payload + the frozen booking (lines / totals / payments / moves)
    const TERM2 = { key: 'k2b3c4d5-0000-4000-8000-000000000002', id: 'k2b3c4d5-0000-4000-8000-000000000002', posId: 'BAR-2', name: 'Arka 2', branch: 'Qendra', warehouse: 'W1' };
    const pli = (sku, name, unit, qty_q, tot_c, o = {}) => { const vat = Math.sign(tot_c) * Math.round(Math.abs(tot_c) * 18 / 118); return { sku, name, unit, qty_q, unit_t: Math.round(Math.abs(tot_c - vat) * 1e6 / Math.abs(qty_q)), rate: 18, tax: 'E', disc_bp: o.disc_bp || 0, ...(o.disc_c ? { disc_c: o.disc_c } : {}), ...(o.gross_t ? { gross_t: o.gross_t } : {}), sub_c: tot_c - vat, vat_c: vat, tot_c }; };
    const pay = (id, no, status, items, o = {}) => { const tot = k => items.reduce((a, i) => a + i[k], 0), t = o.term || TERM;
      return { id, no, ts: (o.day || '2026-09-20') + ' ' + (o.time || '10:00:00'), shift_id: o.shift || 'SH-9', pos_id: t.posId, pos_name: t.name, branch: 'Qendra', operator: o.operator || 'Ana', customer: o.customer || '', customer_nui: o.nui || '', status, items,
        sub_c: o.total != null ? o.total - Math.round(o.total * 18 / 118) : tot('sub_c'), vat_c: o.total != null ? Math.round(o.total * 18 / 118) : tot('vat_c'), total_c: o.total != null ? o.total : tot('tot_c'), cash_c: o.cash != null ? o.cash : (o.total != null ? o.total : tot('tot_c')), card_c: o.card || 0, change_c: o.change || 0, discount_total_c: o.disc || 0,
        fiscal_status: o.fiscal || 'fiscalized', fiscal_ref: o.ref || '', fiscal_error: o.err || '', fiscal_mode: 'ATK_ELECTRONIC', fiscal_version: 3, ...(o.orig ? { orig_id: o.orig[0], orig_no: o.orig[1] } : {}), ...(o.extra || {}) }; };
    const fz = (p, o = {}) => { const cancel = p.status === 'cancel', sg = v => (cancel ? -Math.abs(v) : v), M = o.mirror;
      const lines = M ? M.lines.map(l => ({ ...l, qty_q: -l.qty_q, sub_c: -l.sub_c, vat_c: -l.vat_c, tot_c: -l.tot_c, disc_c: -l.disc_c }))
        : p.items.map(i => ({ sku: i.sku, name: i.name, unit: i.unit, tax: i.tax, rate: i.rate, qty_q: sg(i.qty_q), unit_t: i.unit_t, sub_c: sg(i.sub_c), vat_c: sg(i.vat_c), tot_c: sg(i.tot_c), disc_c: Math.abs(i.disc_c || 0) * (cancel ? -1 : 1), cost_c: 30, recipe: null }));
      const totals = M ? Object.fromEntries(Object.entries(M.totals).map(([k, v]) => [k, k === 'change_c' ? 0 : -v])) : { sub_c: sg(p.sub_c), vat_c: sg(p.vat_c), total_c: sg(p.total_c), cash_c: sg(p.cash_c), card_c: sg(p.card_c), change_c: cancel ? 0 : p.change_c, discount_c: Math.abs(p.discount_total_c) * (cancel ? -1 : 1) };
      const payments = M ? M.payments.map(x => ({ ...x, amount_c: -x.amount_c })) : [...(totals.cash_c ? [{ account: o.cashAcc || 'cash1', kind: 'cash', amount_c: totals.cash_c }] : []), ...(totals.card_c ? [{ account: 'bank1', kind: 'card', amount_c: totals.card_c }] : [])];
      if (o.noVat) { for (const l of lines) Object.assign(l, { src: { tax: l.tax, rate: l.rate, sub_c: l.sub_c, vat_c: l.vat_c }, tax: 'A', rate: 0, sub_c: l.tot_c, vat_c: 0 }); totals.sub_c = totals.total_c; totals.vat_c = 0; }
      return { lines, totals, payments, moves: lines.map(l => ({ sku: l.sku, wh: 'W2', qm: -Math.round(l.qty_q / 10), cost_c: l.cost_c, via: null })) }; };
    const LBL = { return: 'Kthim', returned: 'Kthyer', void: 'Anuluar', cancel: 'Anulim' };
    const rcv = (p, o = {}) => { const t = o.term || TERM, frozen = o.frozen === null ? null : (o.frozen || fz(p, o));
      return { id: p.id, no: p.no, ts: p.ts, day: p.ts.slice(0, 10), terminalKey: t.key, terminal: { key: t.key, id: t.id, posId: t.posId, name: t.name, branch: t.branch, warehouse: t.warehouse }, seq: o.seq || 1, receivedAt: p.ts.slice(0, 10) + 'T' + p.ts.slice(11) + 'Z',
        status: p.status, statusLabel: LBL[p.status] || 'Finalizuar', fiscalStatus: p.fiscal_status, fiscalRef: p.fiscal_ref || null, fiscalError: p.fiscal_error || null, customer: p.customer, nui: p.customer_nui, operator: p.operator, origId: p.orig_id || null, origNo: p.orig_no || null,
        ledgerState: frozen ? 'ok' : 'new', ledgerError: null, frozen, payload: p, relations: { orig: p.orig_id ? { id: p.orig_id, no: p.orig_no } : null, returns: o.returns || [], cancel: o.cancel || null } }; };
    const I = {};
    I.s1 = rcv(pay('s1', 'BAR-1/0010', 'returned', [pli('KAFE', 'Kafe', 'copë', 20000, 300)], { time: '09:00:00', ref: 'TX-10' }), { returns: [{ id: 'r1', no: 'BAR-1/0011' }] });
    I.r1 = rcv(pay('r1', 'BAR-1/0011', 'return', [pli('KAFE', 'Kafe', 'copë', -10000, -150)], { time: '09:30:00', ref: 'TX-11', orig: ['s1', 'BAR-1/0010'] }));
    I.s2 = rcv(pay('s2', 'BAR-1/0012', 'final', [pli('KAFE', 'Kafe', 'copë', 20000, 300, { gross_t: 15000 }), pli('UJE', 'Ujë', 'shishe', 30000, 300, { disc_bp: 1000, disc_c: 33 })], { time: '11:00:00', operator: 'Besa', customer: 'Drini Market SH.P.K.', nui: '811234500', cash: 200, card: 400, change: 50, fiscal: 'pending' }), { cashAcc: 'cash2' });
    I.s3 = rcv(pay('s3', 'BAR-1/0013', 'void', [pli('UJE', 'Ujë', 'shishe', 10000, 100)], { time: '12:00:00', ref: 'TX-13' }), { cancel: { id: 'c3', no: 'BAR-1/0014' } });
    I.c3 = rcv(pay('c3', 'BAR-1/0014', 'cancel', [], { time: '12:05:00', ref: 'TX-14', total: 0, orig: ['s3', 'BAR-1/0013'], extra: { cancel_reason: 'Gabim në porosi' } }), { mirror: I.s3.frozen });
    I.s4 = rcv(pay('s4', 'BAR-1/0015', 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { time: '13:00:00', fiscal: 'pending' }), { frozen: null });
    I.s5 = rcv(pay('s5', 'BAR-1/0016', 'final', [pli('UJE', 'Ujë', 'shishe', 10000, 100)], { time: '14:00:00' }), { noVat: true });
    I.s6 = rcv(pay('s6', 'BAR-2/0001', 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { term: TERM2, time: '18:00:00', operator: 'Besa', fiscal: 'failed', err: 'ATK: timeout' }), { term: TERM2 });
    I.s7 = rcv(pay('s7', 'BAR-1/0017', 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { time: '15:00:00', extra: { source: 'block', block_no: '0042', block_code: 'BT-7', block_ts: '2026-09-20 14:50' } }));
    const fill = Array.from({ length: 55 }, (_, k) => rcv(pay('f' + k, 'BAR-2/' + (1000 + k), 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { term: TERM2, day: '2026-09-05', time: '10:' + String(k).padStart(2, '0') + ':00', operator: 'Gent', shift: 'SH-2' }), { term: TERM2, seq: k + 10 }));
    const old = rcv(pay('o1', 'BAR-1/0001', 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { day: '2026-08-01', time: '09:00:00' }));
    // the ledger rows these receipts make (days per terminal; the buyer-NUI receipt s2 alone) and two shifts with their totals
    const L1 = row('D:k1a2b3:2026-09-20', 'day', '2026-09-20', { n: 6, counts: { receipts: 4, returns: 1, cancels: 1, voided: 1 }, items: [line('KAFE', 'Kafe', 'copë', 20000, 300, 30), line('UJE', 'Ujë', 'shishe', 10000, 100, 30)], moves: [['KAFE', -2000, 30, 'sale'], ['UJE', -1000, 30, 'sale']], pays: [['cash1', 'cash', 400]], fiscal: { fiscalized: 6 }, extra: { operators: { Ana: { count: 6, total_c: 400, returns_c: 150, cancels_c: 100 } } } });
    const L2 = row('R:s2', 'receipt', '2026-09-20', { no: 'BAR-1/0012', time: '11:00:00', items: [line('KAFE', 'Kafe', 'copë', 20000, 300, 30), line('UJE', 'Ujë', 'shishe', 30000, 300, 30)], moves: [['KAFE', -2000, 30, 'sale'], ['UJE', -3000, 30, 'sale']], pays: [['cash2', 'cash', 200], ['bank1', 'card', 400]], fiscal: { pending: 1 }, fiscalOpen: [{ id: 's2', no: 'BAR-1/0012', ts: '2026-09-20 11:00:00', status: 'pending', error: null }], extra: { customer: 'Drini Market SH.P.K.', nui: '811234500', operator: 'Besa', origId: null, origNo: null, fiscalRef: '', operators: { Besa: { count: 1, total_c: 600, returns_c: 0, cancels_c: 0 } } } });
    const L3 = row('D:k2b3c4:2026-09-20', 'day', '2026-09-20', { no: 'POS-BAR-2-20260920-k2b3c4', time: '18:00:00', items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 30)], moves: [['KAFE', -1000, 30, 'sale']], pays: [['cash1', 'cash', 150]], fiscal: { failed: 1 }, fiscalOpen: [{ id: 's6', no: 'BAR-2/0001', ts: '2026-09-20 18:00:00', status: 'failed', error: 'ATK: timeout' }], extra: { terminal: TERM2, firstTs: '2026-09-20 18:00:00', operators: { Besa: { count: 1, total_c: 150, returns_c: 0, cancels_c: 0 } } } });
    const L4 = row('D:k2b3c4:2026-09-05', 'day', '2026-09-05', { n: 55, no: 'POS-BAR-2-20260905-k2b3c4', items: [line('KAFE', 'Kafe', 'copë', 550000, 8250, 30)], moves: [['KAFE', -55000, 30, 'sale']], pays: [['cash1', 'cash', 8250]], fiscal: { fiscalized: 54, failed: 1 }, fiscalOpen: [{ id: 'f3', no: 'BAR-2/1003', ts: '2026-09-05 10:03:00', status: 'failed', error: 'ATK: 500' }], extra: { terminal: TERM2, operators: { Gent: { count: 55, total_c: 8250, returns_c: 0, cancels_c: 0 } } } });
    const L5 = row('D:k1a2b3:2026-08-15', 'day', '2026-08-15', { n: 2, items: [line('KAFE', 'Kafe', 'copë', 20000, 300, 30)], moves: [['KAFE', -2000, 30, 'sale']], pays: [['cash1', 'cash', 300]], extra: { operators: { Ana: { count: 2, total_c: 300, returns_c: 0, cancels_c: 0 } } } });
    const T9 = mkT('t9', 'Kuponat SH.P.K.', book(), 'on');
    T9.terms = [{ id: TERM.id, name: 'Arka Bar', branch: 'Qendra', posId: 'BAR-1', warehouse: 'W2', status: 'Aktiv', lastSeen: '' }, { id: TERM2.id, name: 'Arka 2', branch: 'Qendra', posId: 'BAR-2', warehouse: 'W1', status: 'Aktiv', lastSeen: '' }];
    T9.rc = [I.s1, I.r1, I.s2, I.s3, I.c3, I.s4, I.s5, I.s6, I.s7, ...fill, old];
    for (const r of [L1, L2, L3, L4, L5]) pub(T9, JSON.parse(JSON.stringify(r)));
    pubShift(T9, { ...SHIFT, id: 'S:k1a2b3:SH-9', shiftId: 'SH-9', opened_at: '2026-09-20 08:00:00', totals: { count: 7, total_c: 1000, cash_c: 600, card_c: 400, returns_c: 150, cancels_c: 100 } });
    pubShift(T9, { ...SHIFT, id: 'S:k2b3c4:SH-2', shiftId: 'SH-2', terminal: TERM2, status: 'closed', opened_at: '2026-09-05 08:00:00', closed_at: '2026-09-05 20:00:00', opening_c: 0, expected_c: 8250, counted_c: 8200, diff_c: -50, operator: 'Gent', totals: { count: 55, total_c: 8250, cash_c: 8250, card_c: 0, returns_c: 0, cancels_c: 0 } });

    // ── posDocFromPayload (pure): the server's frozen lines / totals / payments win; an unprocessed receipt is read like importPosSales reads it
    { const c9 = new C({}); c9.state.db = book(); const vat0 = { ...book(), taxSettings: { ...book().taxSettings, vatRegistered: false } };
      const d2 = c9.posDocFromPayload(I.s2);
      eq([d2.id, d2.kind, d2.no, d2.pos, d2.posName, d2.branch, d2.termKey, d2.operator, d2.date, d2.time, d2.isoDate, d2.customer, d2.nui, d2.status, d2.fiscal, d2.fiscalStatus, d2.fiscalRef, d2.sub, d2.vat, d2.total, d2.cash_c, d2.card_c, d2.change_c, d2.discount, d2.frozen, d2.ledgerState, d2.payments, d2.shift, d2.returns, d2.origId],
        ['s2', 'Kupon POS', 'BAR-1/0012', 'BAR-1', 'Arka Bar', 'Qendra', TERM.key, 'Besa', '20.09.2026', '11:00', '2026-09-20', 'Drini Market SH.P.K.', '811234500', 'Finalizuar', 'Në pritje', 'pending', '—', 508, 92, 600, 200, 400, 50, 0, true, 'ok', [{ account: 'cash2', kind: 'cash', amount_c: 200 }, { account: 'bank1', kind: 'card', amount_c: 400 }], 'SH-9', [], null],
        'posDocFromPayload: a frozen sale — terminal snapshot, operator, buyer + NUI, fiscal label, totals and the frozen payments (their accounts)');
      eq(d2.items.map(i => [i.sku, i.qty, i.qty_q, i.unit_t, i.unit_c, i.gross_t, i.disc, i.disc_c, i.tax, i.rate, i.sub, i.vatc, i.tot]), [['KAFE', 2, 20000, 12700, 127, 15000, 0, undefined, 'E', 18, 254, 46, 300], ['UJE', 3, 30000, 8467, 85, undefined, 10, 33, 'E', 18, 254, 46, 300]], 'posDocFromPayload: frozen lines → ERP items (4-decimal qty / unit, gross_t and disc % from the till\'s own line)');
      const dr1 = c9.posDocFromPayload(I.r1);
      eq([dr1.kind, dr1.status, dr1.total, dr1.sub, dr1.vat, dr1.cash_c, dr1.origId, dr1.origNo, dr1.items.map(i => [i.qty, i.qty_q, i.tot])], ['Kupon POS', 'Kthim', -150, -127, -23, -150, 's1', 'BAR-1/0010', [[-1, -10000, -150]]], 'posDocFromPayload: a return — negative lines and totals, the original\'s id / no');
      const dc3 = c9.posDocFromPayload(I.c3);
      eq([dc3.kind, dc3.status, dc3.total, dc3.sub, dc3.vat, dc3.cash_c, dc3.card_c, dc3.change_c, dc3.cancelReason, dc3.origId, dc3.origNo, dc3.items.map(i => [i.sku, i.qty, i.tot, i.disc]), dc3.payments], ['Anulim kuponi POS', 'Anulim', -100, -85, -15, -100, 0, 0, 'Gabim në porosi', 's3', 'BAR-1/0013', [['UJE', -1, -100, 0]], [{ account: 'cash1', kind: 'cash', amount_c: -100 }]], 'posDocFromPayload: a cancel WITHOUT lines of its own — the server\'s mirrored booking of the original (payload totals 0 ignored)');
      const dw = c9.posDocFromPayload({ ...I.c3, frozen: null, ledgerState: 'wait_orig', payload: { ...I.c3.payload, total_c: 100, sub_c: 85, vat_c: 15, cash_c: 100 } });
      eq([dw.status, dw.items, dw.total, dw.sub, dw.vat, dw.cash_c, dw.payments, dw.frozen], ['Anulim', [], -100, -85, -15, -100, null, false], 'posDocFromPayload: a cancel the server could not book yet (no frozen) — its own amounts, negative');
      const d3 = c9.posDocFromPayload(I.s3), d3b = c9.posDocFromPayload({ ...I.s3, statusLabel: undefined }), dc3b = c9.posDocFromPayload({ ...I.c3, statusLabel: undefined });
      eq([d3.status, d3.cancelId, d3.cancelNo, d3b.status, dc3b.status, d3.total], ['Anuluar', 'c3', 'BAR-1/0014', 'Anuluar', 'Anulim', 100], 'posDocFromPayload: a voided original (cancel relation); without statusLabel the till\'s status decides (void without a reference = Anuluar, cancel with one = Anulim)');
      const d5 = c9.posDocFromPayload(I.s5);
      eq([c9.vatOn(), d5.items.map(i => [i.tax, i.rate, i.sub, i.vatc, i.tot]), d5.sub, d5.vat, d5.total], [true, [['A', 0, 100, 0, 100]], 100, 0, 100], 'posDocFromPayload: a frozen no-VAT booking wins over the till\'s line and over the book\'s VAT setting');
      const d4 = c9.posDocFromPayload(I.s4), d4n = c9.posDocFromPayload(I.s4, vat0);
      eq([d4.frozen, d4.ledgerState, d4.payments, d4.items.map(i => [i.tax, i.rate, i.sub, i.vatc, i.tot]), d4.sub, d4.vat, d4.total], [false, 'new', null, [['E', 18, 127, 23, 150]], 127, 23, 150], 'posDocFromPayload: a receipt not booked yet (no frozen) — read from the till\'s payload');
      eq([d4n.items.map(i => [i.tax, i.rate, i.sub, i.vatc, i.tot]), d4n.sub, d4n.vat, d4n.total], [[['A', 0, 150, 0, 150]], 150, 0, 150], 'posDocFromPayload: no frozen + a book not registered for VAT → group A, no VAT (importPosSales\' rule)');
      const d7 = c9.posDocFromPayload(I.s7); eq([d7.source, d7.blockNo, d7.blockCode, d7.blockTs, c9.posBlockLabel(d7)], ['block', '0042', 'BT-7', '2026-09-20 14:50', 'nga blloku tatimor nr. 0042 (BT-7)'], 'posDocFromPayload: a receipt from the paper tax block');
      // the same document importPosSales books for the same payload (sale, and a cancel with lines of its own and no original in the book)
      const pick = r => [r.kind, r.no, r.status, r.customer, r.nui, r.operator, r.date, r.time, r.sub, r.vat, r.total, r.discount, r.cash_c, r.card_c, r.change_c, r.fiscal, r.fiscalRef, r.origId, r.origNo, r.cancelReason || '', r.items.map(i => [i.sku, i.qty, i.qty_q, i.unit_c, i.unit_t, i.gross_t, i.rate, i.tax, i.disc, i.disc_c, i.sub, i.vatc, i.tot])];
      const cx = pay('cx', 'BAR-1/0099', 'cancel', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { time: '16:00:00', orig: ['zz', 'BAR-1/0098'], extra: { cancel_reason: 'Test' } }), sx = { ...I.s2.payload, id: 'sx', no: 'BAR-1/0098' };
      for (const [p, nm] of [[sx, 'a sale'], [cx, 'a cancel with its own lines']]) for (const db of [book(), vat0]) {
        const loc = new C({}); loc._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' }; loc.state.db = JSON.parse(JSON.stringify(db)); loc.importPosSales([JSON.parse(JSON.stringify(p))], []); clearTimeout(loc._t);
        eq(pick(c9.posDocFromPayload(rcv(p, { frozen: null }), db)), pick(loc.state.db.posReceipts[0]), 'posDocFromPayload without frozen = the document importPosSales books (' + nm + ', VAT ' + (db === vat0 ? 'off' : 'on') + ')'); } }

    // ── P:Shitje / P:Kthime: the server's receipts one by one (GET /pos/receipts → state.posList), loaded from componentDidUpdate
    const R = mkR(); await enter(R, 'own', 't9'); await settle(R);
    const Q31 = 'from=2026-08-21&to=2026-09-20', ST = '&status=final%2Creturned%2Cvoid';
    { eq([R._ledger.loaded, R.state.posList, rcOf('t9', 0)], [true, null, []], 'E-L2: the dashboard asks the server for no receipt list');
      const k0 = S.calls.length, hold = defer(); S.rcHold = (tid, path) => (tid === 't9' && path.startsWith('/pos/receipts?') ? hold.p : null);
      R.go('pos', 'Shitje'); await until(() => R.state.posList && R.state.posList.busy);
      const T0 = R.pageTable('P:Shitje');
      eq([rcOf('t9', k0), T0.title, T0.count, T0.rows.length, T0.empty, T0.hasMore, T0.hasFilters, T0.filters.map(f => [f.title, f.value]), T0.period.map(p => p.label + (p.on ? '*' : ''))],
        [['GET /pos/receipts?' + Q31 + ST + '&limit=50&offset=0'], 'Shitjet nga POS-i', '', 0, 'Duke ngarkuar kuponët nga serveri…', false, true, [['Nga data', '2026-08-21'], ['Deri më', '2026-09-20'], ['Arka', ''], ['Statusi', '']], ['Sot', '7 ditë', 'Ky muaj', '31 ditë*']],
        'P:Shitje (ledger): GET /pos/receipts — the last 31 days, the sale statuses, 50 per page; while it loads: no rows, no count, the loading text');
      S.rcHold = null; hold.open(); await settle(R);
      const T = R.pageTable('P:Shitje');
      eq([T.count, T.rows.length, T.hasMore, T.moreLabel, T.footer, rcOf('t9', k0).length], ['62', 50, true, 'Shfaq më shumë (12 nga 12 të tjerë)', 'Shfaqen 50 nga 62 kupona · ' + R.fmt(8000), 1], 'P:Shitje: the first 50 of 62, the total from the server, "Shfaq më shumë"');
      eq(T.rows.slice(0, 7).map(cellsT), [['BAR-2/0001', '20.09.2026 18:00', 'Arka 2', 'Besa', 'Klient me shumicë', '1', '€1.50', '€0.00', '€1.50', 'Në rregull', 'Dështoi', '—'], ['BAR-1/0017', '20.09.2026 15:00', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '€1.50', '€0.00', '€1.50', 'Në rregull', 'Fiskalizuar', '—'],
        ['BAR-1/0016', '20.09.2026 14:00', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '€1.00', '€0.00', '€1.00', 'Në rregull', 'Fiskalizuar', '—'], ['BAR-1/0015', '20.09.2026 13:00', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '€1.50', '€0.00', '€1.50', 'Në rregull', 'Në pritje', '—'],
        ['BAR-1/0013', '20.09.2026 12:00', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '€1.00', '€0.00', '€1.00', 'Anuluar', 'Fiskalizuar', '—'], ['BAR-1/0012', '20.09.2026 11:00', 'Arka Bar', 'Besa', 'Drini Market SH.P.K.', '2', '€2.00', '€4.00', '€6.00', 'Në rregull', 'Në pritje', '—'],
        ['BAR-1/0010', '20.09.2026 09:00', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '€3.00', '€0.00', '€3.00', 'Kthyer', 'Fiskalizuar', '—']], 'P:Shitje: one row per receipt, newest first (number, time, till, operator, buyer, items, cash, card, total, status, fiscal, A4)');
      eq([T.rows[0].cells[10].sub, T.rows[1].cells[0].sub, T.rows[3].cells[0].sub, T.rows[4].cells[9].sub, T.rows[5].cells[4].sub, T.rows[6].cells[9].sub], ['ATK: timeout', 'nga blloku tatimor nr. 0042 (BT-7)', 'në përpunim në server', 'anuluar me BAR-1/0014', 'NUI 811234500', '1 kthim: BAR-1/0011'], 'P:Shitje: the fiscal error, the tax block, a receipt not booked yet, the cancel / return relations, the buyer\'s NUI');
      eq(T.kpis.map(k => [k.label, k.value, k.sub]), [['Shitje sot (neto)', R.fmt(1150), '8 kupona · neto nga 2 kthime/anulime'], ['Para', R.fmt(750), ''], ['Kartë', R.fmt(400), ''], ['Fiskalizimi sot', '2 pa fiskalizuar', '1 dështuan']], 'P:Shitje: today\'s KPIs from the ledger rows in memory (no extra call)');
      // "Shfaq më shumë": the next page (offset = what is loaded), appended
      const k1 = S.calls.length; T.more(); await settle(R); const Tm = R.pageTable('P:Shitje');
      eq([rcOf('t9', k1), Tm.rows.length, Tm.count, Tm.hasMore, new Set(R.state.posList.items.map(x => x.id)).size, Tm.footer], [['GET /pos/receipts?' + Q31 + ST + '&limit=50&offset=50'], 62, '62', false, 62, 'Shfaqen 62 nga 62 kupona · ' + R.fmt(9800)], 'P:Shitje "Shfaq më shumë": GET …&offset=50, appended (62 rows, no duplicate, no more button)');
      // CSV of what is loaded
      const blobs = []; Object.assign(ctx, { Blob: class { constructor(parts) { blobs.push(parts.join('')); } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } }); ctx.document.createElement = () => ({ click() {}, remove() {} }); ctx.document.body = { appendChild() {} };
      try { Tm.actions.find(a => a.label === 'Eksporto CSV').go(); } finally { delete ctx.document.createElement; delete ctx.document.body; }
      const csv = (blobs[0] || '').replace(/^﻿/, '').split('\r\n');
      eq([csv.length, csv[0], csv[6], /62 rreshta/.test(R.state.toast || '')], [63, 'Kuponi;Data;Arka;Operatori;Klienti;Artikuj;Para;Kartë;Totali;Statusi;Fiskalizimi;Fatura A4', 'BAR-1/0012;20.09.2026 11:00;Arka Bar (Qendra);Besa;Drini Market SH.P.K. (NUI 811234500);2;€2.00;€4.00;€6.00;Në rregull;Në pritje;—', true], 'P:Shitje: the CSV exports the 62 receipts loaded'); }
    // filters: period / terminal / status / dates → the exact query; a new filter starts again at page 1
    { const go = async f => { const k = S.calls.length; f(); await settle(R); return rcOf('t9', k); }, T = () => R.pageTable('P:Shitje'), flt = t => T().filters.find(f => f.title === t);
      eq(await go(() => T().period.find(p => p.label === 'Sot').go()), ['GET /pos/receipts?from=2026-09-20&to=2026-09-20' + ST + '&limit=50&offset=0'], 'P:Shitje "Sot": from = to = today, back to the first page');
      eq([T().count, T().rows.map(r => r.cells[0].t)], ['7', ['BAR-2/0001', 'BAR-1/0017', 'BAR-1/0016', 'BAR-1/0015', 'BAR-1/0013', 'BAR-1/0012', 'BAR-1/0010']], 'P:Shitje "Sot": today\'s 7 sales');
      eq(await go(() => T().period.find(p => p.label === '7 ditë').go()), ['GET /pos/receipts?from=2026-09-14&to=2026-09-20' + ST + '&limit=50&offset=0'], 'P:Shitje "7 ditë"');
      eq(await go(() => T().period.find(p => p.label === 'Ky muaj').go()), ['GET /pos/receipts?from=2026-09-01&to=2026-09-20' + ST + '&limit=50&offset=0'], 'P:Shitje "Ky muaj"');
      eq([flt('Arka').opts.map(o => [o.id, o.label])], [[['', 'Arka: të gjitha'], [TERM.id, 'Arka Bar (BAR-1)'], [TERM2.id, 'Arka 2 (BAR-2)']]], 'P:Shitje: the terminal filter lists the company\'s terminals (by terminal key)');
      eq(await go(() => flt('Arka').set({ target: { value: TERM2.key } })), ['GET /pos/receipts?from=2026-09-01&to=2026-09-20&terminal=' + TERM2.key + ST + '&limit=50&offset=0'], 'P:Shitje: the terminal filter → terminal=<key>');
      eq([T().count, T().rows.length, flt('Arka').value], ['56', 50, TERM2.key], 'P:Shitje: 56 receipts of that terminal this month');
      eq(await go(() => flt('Statusi').set({ target: { value: 'void' } })), ['GET /pos/receipts?from=2026-09-01&to=2026-09-20&terminal=' + TERM2.key + '&status=void&limit=50&offset=0'], 'P:Shitje: the status filter → status=void');
      eq([T().count, T().rows.length, T().empty], ['0', 0, 'Asnjë kupon për këtë filtër — ndryshoni periudhën, arkën, statusin ose kërkimin.'], 'P:Shitje: an empty result says so');
      eq(await go(() => { R.posFilter({ terminal: '', status: '' }); }), ['GET /pos/receipts?from=2026-09-01&to=2026-09-20' + ST + '&limit=50&offset=0'], 'P:Shitje: filters cleared');
      eq(await go(() => flt('Nga data').set({ target: { value: '2026-08-01' } })), ['GET /pos/receipts?from=2026-08-01&to=2026-09-20' + ST + '&limit=50&offset=0'], 'P:Shitje: a typed start date → custom period (the end date kept)');
      eq([T().count, T().period.filter(p => p.on).map(p => p.label), flt('Nga data').value], ['63', ['01.08.2026 – 20.09.2026'], '2026-08-01'], 'P:Shitje: the custom period is shown as the active period');
      eq(await go(() => flt('Deri më').set({ target: { value: '2026-08-31' } })), ['GET /pos/receipts?from=2026-08-01&to=2026-08-31' + ST + '&limit=50&offset=0'], 'P:Shitje: a typed end date');
      eq([T().rows.map(r => r.cells[0].t)], [['BAR-1/0001']], 'P:Shitje: August holds the one old receipt');
      // the search waits for the typing to stop (300 ms) and then asks once
      await go(() => T().period.find(p => p.label === '31 ditë').go());
      const k2 = S.calls.length; T().setQ({ target: { value: 'b' } }); await wait(60); T().setQ({ target: { value: 'be' } }); await wait(60); T().setQ({ target: { value: 'Bes' } }); await wait(60);
      eq([rcOf('t9', k2), R.state.posList.base.endsWith('|q='), T().rows.length], [[], true, 50], 'search: nothing is asked while typing — the previous list stays');
      await wait(300); await settle(R);
      eq([rcOf('t9', k2), T().count, T().rows.map(r => r.cells[3].t), T().q], [['GET /pos/receipts?' + Q31 + ST + '&q=Bes&limit=50&offset=0'], '2', ['Besa', 'Besa'], 'Bes'], 'search: ONE request with q=Bes after the typing stopped (300 ms)');
      const k3 = S.calls.length; R.setState({ x: 1 }); R.setState({ x: 2 }); await settle(R); R.go('pos', 'Shitje'); await settle(R);
      eq(rcOf('t9', k3), [], 'P:Shitje: unrelated updates and coming back to the same filter ask nothing again');
      R.posFilter({ q: '' }); await wait(350); await settle(R); }
    // P:Kthime: returns + cancels (ATK CANCEL); a refusal is an error state, not a spinner (and no retry loop)
    { const k0 = S.calls.length; R.go('pos', 'Kthime'); await settle(R); const T = R.pageTable('P:Kthime');
      eq([rcOf('t9', k0), T.title, T.count, T.rows.map(cellsT), T.rows.map(r => r.cells[9].sub)], [['GET /pos/receipts?' + Q31 + '&status=return%2Ccancel&limit=50&offset=0'], 'Kthimet nga POS-i', '2',
        [['BAR-1/0014', '20.09.2026 12:05', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '-€1.00', '€0.00', '-€1.00', 'Anuluar', 'Fiskalizuar', '—'], ['BAR-1/0011', '20.09.2026 09:30', 'Arka Bar', 'Ana', 'Klient me shumicë', '1', '-€1.50', '€0.00', '-€1.50', 'Kthyer', 'Fiskalizuar', '—']], ['anulim i BAR-1/0013', 'kthim i BAR-1/0010']],
        'P:Kthime: status=return,cancel — the cancel (mirrored by the server) and the return, negative, with their originals');
      eq(T.kpis.map(k => [k.label, k.value, k.sub]), [['Kthime sot', '-€1.50', '1 kthim'], ['Anulime sot', '-€1.00', '1 anulim'], ['Në listë', '2', 'sipas filtrave'], ['Fiskalizimi sot', '2 pa fiskalizuar', '1 dështuan']], 'P:Kthime: today\'s returns / cancels from the ledger rows');
      eq(await (async () => { const k = S.calls.length; T.filters.find(f => f.title === 'Statusi').set({ target: { value: 'cancel' } }); await settle(R); return [rcOf('t9', k), R.pageTable('P:Kthime').count]; })(), [['GET /pos/receipts?' + Q31 + '&status=cancel&limit=50&offset=0'], '1'], 'P:Kthime: "Anulime" → status=cancel');
      R.posFilter({ status: '' }); await settle(R);
      T9.rcDeny = true; const k1 = S.calls.length; R.go('pos', 'Shitje'); await settle(R); let Td = R.pageTable('P:Shitje');
      eq([rcOf('t9', k1).length, R.state.posList.busy, Td.rows.length, Td.count, Td.empty, Td.kpis.length], [1, false, 0, '', 'Nuk keni leje për kuponët e POS-it — kërkojini pronarit qasjen.', 4], 'a refused list (403): the error in place of the rows — not an endless "Duke ngarkuar"');
      R.setState({ x: 3 }); await settle(R); R.renderVals(); R.setState({ x: 4 }); await settle(R);
      eq(rcOf('t9', k1).length, 1, 'a refused list is not asked again on every update');
      T9.rcDeny = false; Td.actions.find(a => a.label === 'Rifresko').go(); await settle(R); Td = R.pageTable('P:Shitje');
      eq([rcOf('t9', k1).length, Td.count, Td.rows.length], [2, '62', 50], '"Rifresko" asks again'); }
    // @@E-L2-END@@
  }).catch(e => { console.log('FAIL E-L2 tests threw: ' + (e && e.stack || e)); process.exitCode = 1; });
