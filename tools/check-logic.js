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
  const html = c.docPrintHtml(a4d); eq([/Zbritje në faturë/.test(html), html.includes('− ' + c.fmtEu(100)), html.includes('Vlera para zbritjes</span><span>' + c.fmtEu(2100)), /Nëntotali/.test(html), html.includes('Baza e tatueshme</span><span>' + c.fmtEu(1695))], [true, true, true, false, true], 'A4 print: an invoice discount prints a gross ladder that closes (21,00 − 1,00 = 20,00), without a second subtotal');
  eq(/Zbritje në faturë/.test(c.docPrintHtml(db().invoices.find(r => r.no === 'FSH-2026-00124'))), false, 'A4 print: no discount line on ordinary invoices');
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
{ // a 4-decimal POS line (0.3755) and its return net to zero in stock: exact thousandths from qty_q, halves away from zero (Math.round on the float left 1/1000)
  const s0 = c.stockOf('RR-001'), L1 = { ...it('RR-001', 'Rërë', 376, 1000), qty_q: 3755 }, L2 = { ...it('RR-001', 'Rërë', -376, 1000), qty_q: -3755 };
  c.importPosSales([rcpt('r-q4', 'POS-0001/000090', 'final', 'pending', [L1], L1.tot_c, 0)], []); const s1 = c.stockOf('RR-001');
  c.importPosSales([rcpt('r-q4r', 'POS-0001/000091', 'return', 'pending', [L2], L2.tot_c, 0, { orig_id: 'r-q4' })], []);
  eq([s1 - s0, c.stockOf('RR-001') - s0], [-376, 0], 'local POS import: 0.3755 out and back in nets to zero (−376 / +376)');
}

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
{ const h = c.docPrintHtml(invOf('FSH-2026-00125')); eq([h.includes('FSH-2026-00125'), h.includes('FATURË'), h.includes('Drini Market'), h.includes(c.fmtEu(277064)), h.includes('KS-TX-7F3A21')], [true, true, true, true, true], 'print html: invoice carries number, title, customer, total, fiscal ref'); }
{ const h = c.docPrintHtml(purOf('BL-2026-00033')); eq([h.includes('BLERJE'), h.includes('FURNITORI')], [true, true], 'print html: purchase document'); }
// ── formati A4 “Precision Flow” (dizajni i faturës) ──
// Invariantët e parasë te dokumenti i shtypur: kolona “Shuma” mbledh bazën, TVSH-ja ndahet pa rreshta negativë,
// dhe shkalla e pagesave mbyllet (Totali − paguar − notë krediti = Mbetja) — edhe kur nota e kreditit u rimbursua.
{
  const euro = t => { const m = String(t).match(/([\d.]+),(\d{2})/); return m ? Math.round(parseFloat(m[1].replace(/\./g, '') + '.' + m[2]) * 100) : null; };
  const lineOf = (h, label) => { const m = h.match(new RegExp('<span class="k">' + label + '[^<]*</span><span[^>]*>([^<]*)</span>')); return m ? euro(m[1]) : null; };
  const ladder = (doc, name) => {
    const h = c.docPrintHtml(doc);
    const cells = [...h.matchAll(/<td class="am r">([^<]*)<\/td>/g)].map(m => euro(m[1])).filter(x => x !== null);
    const sum = cells.reduce((a, b) => a + b, 0);
    const base = lineOf(h, 'Baza e tatueshme');
    const vats = [...h.matchAll(/<span class="k">TVSH [\d.]+%<\/span><span>([^<]*)<\/span>/g)].map(m => euro(m[1]));
    const total = euro((h.match(/Totali i [^<]*<\/span><span class="v">([^<]*)</) || [])[1]);
    const rest = euro((h.match(/Mbetja për pagesë<\/span><span class="v">([^<]*)</) || [])[1]);
    const paid = lineOf(h, 'Shuma e paguar'), credit = lineOf(h, 'Notë krediti e aplikuar');
    eq([sum === base, vats.every(v => v > 0), total === base + vats.reduce((a, b) => a + b, 0), rest === null || total - (paid || 0) - (credit || 0) === rest],
       [true, true, true, true], 'A4 ' + name + ': Σ “Shuma” = Baza, TVSH pozitive, Baza+TVSH = Totali, Totali−paguar−notë = Mbetja');
    return h;
  };
  const inv0 = db().invoices.find(r => r.kind === 'Faturë' && (r.items || []).length);
  ladder(inv0, 'faturë e ERP-së');
  // bllokuesi i rishikimit: faturë e paguar me notë krediti të rimbursuar — “paguar” nuk guxon ta përthithë notën
  const h = ladder({ ...inv0, paid: inv0.total, credited: inv0.total, creditApplied: 0 }, 'faturë e paguar + notë krediti e rimbursuar');
  eq([/Nga nota e kreditit, e rimbursuar/.test(h), /Shuma e paguar<\/span><span>− €/.test(h)], [true, false], 'A4: pjesa e rimbursuar e notës shfaqet jashtë shkallës, në formatin e faturës');
  const mk = items => ({ ...inv0, items, sub: items.reduce((a, i) => a + i.sub, 0), vat: items.reduce((a, i) => a + i.vatc, 0),
    total: items.reduce((a, i) => a + i.sub + i.vatc, 0), paid: 0, credited: 0, creditApplied: 0 });
  // pikërisht rastet ku rillogaritja nga çmimi × sasia e ndante kolonën nga baza (POS: zbritje si vlerë,
  // çmime me katër dhjetore, biznes pa TVSH) dhe ai me dy norma TVSH-je
  ladder(mk([{ name: 'Zbritje si vlerë', sku: 'X1', unit: 'copë', qty: 1, unit_c: 10000, rate: 18, tax: 'E', disc: 0, disc_c: 2000, sub: 8000, vatc: 1440, tot: 9440 }]), 'zbritje si vlerë (disc_c)');
  ladder(mk([{ name: 'Çmim 4 dhjetore', sku: 'X2', unit: 'copë', qty: 120, unit_c: 151, rate: 8, tax: 'D', disc: 0, sub: 18082, vatc: 1447, tot: 19529 }]), 'çmim me katër dhjetore');
  ladder(mk([{ name: 'Pa TVSH', sku: 'X3', unit: 'copë', qty: 1, unit_c: 10000, rate: 0, tax: 'A', disc: 0, sub: 11800, vatc: 0, tot: 11800 }]), 'biznes pa TVSH');
  ladder(mk([{ name: 'Normë 18', sku: 'A', unit: 'copë', qty: 1, unit_c: 10000, rate: 18, tax: 'E', disc: 0, sub: 10000, vatc: 1800, tot: 11800 },
             { name: 'Normë 8', sku: 'B', unit: 'copë', qty: 3, unit_c: 3333, rate: 8, tax: 'D', disc: 0, sub: 9999, vatc: 800, tot: 10799 }]), 'dy norma TVSH-je');
  eq(/<td class="di r">− /.test(c.docPrintHtml(mk([{ name: 'Z', sku: 'X1', unit: 'copë', qty: 1, unit_c: 10000, rate: 18, tax: 'E', disc: 0, disc_c: 2000, sub: 8000, vatc: 1440, tot: 9440 }]))), true,
     'A4: zbritja e dhënë si vlerë (disc_c) shfaqet te kolona e zbritjes, jo “—”');
  // çdo klasë që shkruan faqezuesi ose HTML-ja duhet të ketë rregull në PRINT_CSS (shiriti i theksit u zhduk pikërisht kështu)
  const made = [...c.PRINT_PAGER.matchAll(/className=['"]([a-z]+)['"]/g)].map(m => m[1]);
  const used = [...new Set([...c.docPrintHtml(inv0).matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(' ')))].filter(x => x !== 'doc');
  eq([made.filter(cl => !c.PRINT_CSS.includes('.' + cl + '{')), used.filter(cl => !new RegExp('\\.' + cl + '[{ ,.:]').test(c.PRINT_CSS))], [[], []],
     'A4: çdo klasë e faqezuesit dhe e dokumentit ka rregullin e vet në PRINT_CSS');
}

// ── faqezuesi (PRINT_PAGER) pa shfletues: një DOM i rremë me lartësi të skriptuara ──
{
  const MM = 3.78;                                   // px për mm, si në 96 dpi
  const el = (cls, h = 0) => ({ className: cls, children: [], style: {}, _h: h, textContent: '',
    appendChild(c2) { c2._p = this; this.children.push(c2); return c2; },
    removeChild(c2) { this.children = this.children.filter(x => x !== c2); },
    get parentNode() { return this._p; },
    cloneNode(deep) { const e2 = el(this.className, this._h); e2.textContent = this.textContent;
      if (deep) this.children.forEach(ch => e2.appendChild(ch.cloneNode(true))); return e2; },
    getBoundingClientRect() { return { height: this._h }; },
    querySelector(sel) { return find(this, sel)[0] || null; },
    querySelectorAll(sel) { return find(this, sel); } });
  const matches = (n2, sel) => sel === 'thead' ? n2.className === 'thead'
    : sel === 'tbody>tr' ? n2.className === 'tr'
    : sel === 'table.items' ? n2.className === 'items'
    : n2.className.split(' ').includes(sel.replace(/^\./, ''));
  const find = (root, sel) => { const out = []; const walk = n2 => { n2.children.forEach(ch => { if (matches(ch, sel)) out.push(ch); walk(ch); }); }; walk(root); return out; };
  const run = (docs) => {
    const body = el('body'), out = el('out'), src = el('src');
    body.appendChild(src); body.appendChild(out);
    docs.forEach(d => { const doc = el('doc');
      doc.appendChild(el('head', d.headH * MM));
      doc.appendChild(el('cont', d.contH * MM));
      const tbl = el('items'); tbl.appendChild(el('thead', d.theadH * MM));
      const tb = el('tbody'); for (let i = 0; i < d.rows; i++) tb.appendChild(el('tr', (d.rowH || 9) * MM));
      tbl.appendChild(tb); doc.appendChild(tbl);
      doc.appendChild(el('tail', d.tailH * MM));
      const foot = el('foot', 6 * MM); foot.appendChild(el('pg')); doc.appendChild(foot);
      src.appendChild(doc); });
    const document2 = { body, createElement: t => el(t === 'section' ? 'section' : t === 'div' ? '' : t),
      getElementById: () => out, querySelector: sel => find(body, sel)[0] || null,
      querySelectorAll: sel => sel === '.src .doc' ? find(body, '.doc') : find(body, sel) };
    const win = { __ktbPreview: 1, addEventListener: (_e, f) => f(), focus() {}, print() { throw new Error('nuk duhet printuar në parapamje'); } };
    // probe-i i mm-it: elementi i parë me height:100mm
    const origCreate = document2.createElement;
    document2.createElement = t => { const e2 = origCreate(t); if (!document2._probed) { document2._probed = true; e2._h = 100 * MM; } return e2; };
    new Function('window', 'document', c.PRINT_PAGER)(win, document2);
    return out.children.map(p => ({ rows: find(p, 'tbody>tr').length, head: !!find(p, '.head').length, cont: !!find(p, '.cont').length,
      thead: !!find(p, 'thead').length, tail: !!find(p, '.tail').length, more: !!find(p, '.more').length,
      pg: (find(p, '.pg')[0] || {}).textContent }));
  };
  const one = run([{ rows: 2, headH: 70, contH: 12, theadH: 7, tailH: 60 }]);
  eq([one.length, one[0].rows, one[0].head, one[0].tail, one[0].more, one[0].pg], [1, 2, true, true, false, 'Faqe 1 nga 1'], 'faqezuesi: një faturë e shkurtër mbetet në një faqe');
  const many = run([{ rows: 40, headH: 70, contH: 12, theadH: 7, tailH: 60 }]);
  eq([many.length > 2, many[0].head, many.slice(1).every(p => p.cont && !p.head), many.every(p => !p.rows || p.thead),
      many.slice(0, -1).every(p => p.more), many[many.length - 1].more, many[many.length - 1].tail, many[many.length - 1].rows > 0,
      many.map(p => p.pg)[0], many[many.length - 1].pg],
     [true, true, true, true, true, false, true, true, 'Faqe 1 nga ' + many.length, 'Faqe ' + many.length + ' nga ' + many.length],
     'faqezuesi: koka e plotë vetëm në faqen 1, “vazhdim” në të tjerat, thead kudo ku ka rreshta, “Vazhdon” deri te e parafundit, bishti dhe të paktën një rresht në të fundit');
  const budget = (297 - 15 - 20 - 2) * MM;
  const over = many.map((p, i) => (i === 0 ? 70 + 4 : 12 + 6) * MM + (p.thead ? 7 * MM : 0) + p.rows * 9 * MM + (p.tail ? 60 * MM : 0) + (p.more ? 9 * MM : 0)).filter(h => h > budget + 0.5);
  eq(over, [], 'faqezuesi: asnjë faqe nuk e kalon buxhetin e përmbajtjes (asnjë mbivendosje me footer-in)');
  const two = run([{ rows: 3, headH: 70, contH: 12, theadH: 7, tailH: 60 }, { rows: 30, headH: 70, contH: 12, theadH: 7, tailH: 60 }]);
  const labels = two.map(p => p.pg);
  eq([labels[0], labels[1], labels[labels.length - 1], two.filter(p => p.head).length], ['Faqe 1 nga 1', 'Faqe 1 nga ' + (two.length - 1), 'Faqe ' + (two.length - 1) + ' nga ' + (two.length - 1), 2],
     'faqezuesi: dy dokumente në një punë printimi numërohen veç e veç dhe secili nis me kokën e vet');
  const tight = run([{ rows: 24, headH: 70, contH: 12, theadH: 7, tailH: 60 }]);
  eq(tight[tight.length - 1].rows > 0, true, 'faqezuesi: faqja e fundit nuk mbetet kurrë vetëm me totalet');
}

{ const inv = invOf('FSH-2026-00125'), ph = c.previewHtml(inv);
  eq([ph.startsWith('<!doctype html>'), ph.includes('window.__ktbPreview=1'), ph.includes('<div class="src">'), ph.includes('id="out"'), ph.includes(inv.no)], [true, true, true, true, true],
     'parapamja në ekran është I NJËJTI dokument si printimi, vetëm pa dialogun e printimit');
  eq(c.previewHtml(null), '', 'previewHtml pa dokument kthen bosh');
  c.state.drawer = 'FSH-2026-00125'; c.state.section = 'shitje'; c.state.page = 'Fatura'; c.state.modal = null;
  eq(c.renderVals().inv.previewHtml, '', 'parapamja nuk ndërtohet derisa modali të hapet');
  c.state.modal = 'print'; const v = c.renderVals();
  eq([v.showPrint, v.inv.previewHtml.includes('<article class="doc">'), Number(v.inv.previewScale) > 0.4 && Number(v.inv.previewScale) <= 0.95, Number(v.inv.previewH) >= 1123], [true, true, true, true], 'me modalin e hapur, iframe-i merr dokumentin e plotë, të shkallëzuar sa hyn te modali');
  eq([c.previewBox(inv, false).previewHtml, c.previewBox(null, true).previewHtml], ['', ''], 'parapamja nuk ndërtohet pa modal ose pa dokument');
  { const many = {...inv, items: Array.from({length: 30}, (_, i) => inv.items[i % inv.items.length])}; eq(Number(c.previewBox(many, true).previewH) > 2 * 1123, true, 'një dokument me 30 rreshta merr lartësi për faqe të shumta'); }
  c.state.modal = null; c.state.drawer = null; }
{ const inv = invOf('FSH-2026-00125'), h = c.docPrintHtml(inv);
  eq([/<article class="doc">/.test(h), /<div class="head">/.test(h), /<div class="cont">/.test(h), /<div class="tail">/.test(h), /<div class="foot">/.test(h)], [true, true, true, true, true],
     'A4: the document carries the blocks the paginator needs (head · cont · tail · foot)');
  eq([/<th class="nr">Nr\.<\/th>/.test(h), /Përshkrimi/.test(h), /Njësia/.test(h), /Sasia/.test(h), /Çmimi\/njësi/.test(h), /Shuma/.test(h)], [true, true, true, true, true, true], 'A4: the columns of the design');
  eq([h.includes('TË DHËNAT PËR PAGESË'), h.includes('Totali i faturës'), h.includes('Mbetja për pagesë'), h.includes('Për kompaninë'), h.includes('Për klientin')], [true, true, true, true, true],
     'A4: payment block, invoice total, remaining, both signature lines');
  eq([/TVSH 18%<\/span><span>/.test(h), /Baza e tatueshme/.test(h)], [true, true], 'A4: VAT is split per rate above the taxable base');
  eq(h.includes(c.fmtEu(222000)) && !h.includes('€2,220.00'), true, 'A4: European number format (2.220,00 €), not the on-screen one');
  eq([/<svg[^>]*class="bc"/.test(h), /class="pg"/.test(h), /Gjeneruar me/.test(h)], [true, true, true], 'A4: invoice-number barcode, page-label slot and the platform branding in the footer'); }
{ const db2 = c.state.db; const keep = db2.invoiceSettings;
  c.state.db = {...db2, invoiceSettings:{...keep, showBarcode:false, showSignature:false, showBranding:false, logoStyle:'wordmark', accent:'#0F766E'}};
  const h = c.docPrintHtml(invOf('FSH-2026-00125'));
  eq([/class="bc"/.test(h), /Për kompaninë/.test(h), /Gjeneruar me/.test(h), /class="lgw"/.test(h), c.printCss().includes('--ac:#0F766E')], [false, false, false, true, true],
     'A4: the toggles really remove the barcode, the signatures and the branding; the wordmark and the accent colour follow the settings');
  c.state.db = {...db2, invoiceSettings:{...keep, template:'Minimal'}};
  eq([c.printCss().includes('--thbg:#FFFFFF'), c.printCss().includes('--totbd:.6mm solid #10243A')], [true, true], 'A4: the “Minimal” template is the low-ink print variant');
  c.state.db = db2; }
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
  const h = c.docPrintHtml(inv); eq([/<td class="vt r">A<\/td>/.test(h), /TVSH \d+%/.test(h), /Nr\. TVSH/.test(h)], [true, false, false], 'A4 print (non-VAT): letter A per line, no TVSH total line, no VAT number in the header');
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
// ══ Faza B · rishikimi (E-P, P1–P5): a recipe is never bought (P1), Lëvizjet newest by date (P2), recipe restock rounded once per ingredient and
// cumulatively (P3), purchase returns from the purchase's warehouse (P4), R:Shitje by article nets the cost of credit notes / POS returns (P5) ══
{ const mkC = () => { const x = new C({}); x.state.db = x.seedDb(); Object.assign(x.state, { dr: null, frm: null, drawer: null, admin: false, pdq: '', fq: '', pFilter: 'Të gjitha', toast: null }); return x; };
  const blk = (name, f) => { try { f(); } catch (e) { console.log('FAIL ' + name + ' threw: ' + (e && e.stack || e)); process.exitCode = 1; } };
  const mvR = (x, ref) => x.state.db.movements.filter(m => m.ref === ref).map(m => [m.type, m.sku, m.qm, m.via || '', m.unit_c, m.wh || '']);
  const il = (x, sku, qty, unit_c = 450) => { const l = x.calcLine({ unit_c, qm: Math.round(qty * 1000), rate: 18, bp: 0 }), p = x.prodOf(x.state.db, sku) || {}; return { name: p.name, sku, unit: p.unit, qty, unit_c, rate: 18, tax: 'E', disc: 0, sub: l.sub, vatc: l.vatc, tot: l.tot }; };
  const kit = (sku, qty_q) => ({ ...it(sku, sku, Math.round(qty_q / 10), 450), qty_q }), day = { date: '2026-09-20', due: '2026-10-05' }, ret = (x, kind, ref, items) => x.createReturn({ kind, ref, items, date: '2026-09-20', reason: '', account: 'bank1' });
  // P1 — a product a draft document still expects as stock cannot become a recipe; a recipe line is never received, bought or returned to a supplier
  blk('P1', () => { const x = mkC(), d = () => x.state.db, sup = d().suppliers[0].name, cu = d().customers[0];
    for (const p of [P('VOD', 'Vodka', 'l', 7000, 1200), P('MIX', 'Mix', 'gotë', 0, 200), P('MX2', 'Mix 2', 'gotë', 0, 200), P('MX3', 'Mix 3', 'gotë', 0, 200)]) x.addProduct(p);
    const bl = x.createPurchase({ supplier: sup, items: [il(x, 'MIX', 10, 200)], ...day, note: '', receive: false }), po = x.createPo({ supplier: sup, items: [il(x, 'MX2', 5, 200)], ...day, note: '' });
    x.issueBatch([{ cust: cu, items: [il(x, 'MX3', 1)], note: '' }], 'draft', day); const fd = d().invoices[0].no;
    const tryRec = sku => { x.state.toast = null; const r = x.updateProduct(sku, { recipe: [{ sku: 'VOD', qm: 40 }] }); return [r, x.isRecipe(x.prodOf(d(), sku)), (x.state.toast || '').includes('presin (')]; };
    eq([tryRec('MIX'), tryRec('MX2'), tryRec('MX3'), (x.state.toast || '').includes(fd), d().purchases.find(p => p.no === bl).status], [[false, false, true], [false, false, true], [false, false, true], true, 'Draft'], 'P1: a product on a Draft purchase / an open purchase order / a draft invoice cannot become a recipe (the document is named)');
    x.state.toast = null; eq([x.unitLocked(d(), x.prodOf(d(), 'MIX')), x.updateProduct('MIX', { unit: 'copë' }), /dokument draft/.test(x.state.toast || '')], [true, false, true], 'P1: the unit of a product on a draft document is locked');
    x.cancelPo(po); eq([x.unitLocked(d(), x.prodOf(d(), 'MX2')), x.updateProduct('MX2', { recipe: [{ sku: 'VOD', qm: 40 }] }), x.isRecipe(x.prodOf(d(), 'MX2'))], [false, true, true], 'P1: once the purchase order is cancelled the product is free again (unit, recipe)');
    // older books: a Draft purchase whose product became a recipe before this rule — receiving it is refused (ledger, stock and cost untouched)
    x.state.db = { ...d(), products: d().products.map(p => p.sku === 'MIX' ? { ...p, recipe: [{ sku: 'VOD', qm: 40 }], cost_c: 0 } : p) };
    const g0 = x.balances()['1300'].bal, m0 = d().movements.length; x.state.toast = null; x.receivePurchase(bl);
    eq([d().purchases.find(p => p.no === bl).status, d().movements.length - m0, x.balances()['1300'].bal - g0, x.prodOf(d(), 'MIX').cost_c, /nuk u pranua: MIX është recetë/.test(x.state.toast || '')], ['Draft', 0, 0, 0, true], 'P1: receiving a Draft purchase with a recipe line is refused with a toast — no goods into the ledger without stock, no cost written on the recipe');
    x.state.toast = null; const n0 = d().purchases.length;
    eq([x.createPurchase({ supplier: sup, items: [il(x, 'MIX', 2, 200)], ...day, note: '', receive: true }), x.createPurchase({ supplier: sup, items: [il(x, 'MIX', 2, 200)], ...day, note: '', receive: false }), d().purchases.length - n0, /nuk u regjistrua: MIX/.test(x.state.toast || '')], ['', '', 0, true], 'P1: a purchase with a recipe line (received or draft) is refused');
    // older books: a RECEIVED purchase that carries a product which is a recipe now — its purchase return books no stock of the recipe
    const bl2 = x.createPurchase({ supplier: sup, items: [il(x, 'VOD', 1, 1200)], ...day, note: '', receive: true });
    x.state.db = { ...d(), purchases: d().purchases.map(p => p.no === bl2 ? { ...p, items: [...p.items, il(x, 'MIX', 10, 200)], sub: p.sub + 2000, vat: p.vat + 360, total: p.total + 2360 } : p) };
    const kd = ret(x, 'purchase', bl2, [{ li: 1, qty: 4 }]);
    eq([/^KD-/.test(kd), mvR(x, kd), x.stockOf('MIX'), x.hasMoves(d(), 'MIX')], [true, [], 0, false], 'P1: a purchase return never books stock of a recipe product (no negative own stock)'); });
  // P2 — Lëvizjet / Hyrje në stok / Dalje nga stok newest BY DATE: with the POS ledger the derived rows sit after the book's — today's book rows still come first
  blk('P2', () => { const x = mkC(), d = () => x.state.db, sup = d().suppliers[0].name, rows = new Map();
    for (let k = 1; k <= 30; k++) for (const t of ['k1', 'k2']) { const date = '2026-08-' + String(k).padStart(2, '0'), id = 'D:' + t + ':' + date;
      rows.set(id, { id, kind: 'day', no: 'POS-' + t + '-' + date, date, lastTs: date + ' 22:00:00', terminal: { key: t, posId: t, name: t }, totals: { sub_c: 0, vat_c: 0, total_c: 0 }, items: [], payments: [], moves: Array.from({ length: 12 }, () => ({ sku: 'LED-18', qm: -1, cost_c: 510 })) }); }
    const bl = x.createPurchase({ supplier: sup, items: [{ name: 'Ndriçues LED 18W', sku: 'LED-18', unit: 'copë', qty: 50, unit_c: 500, rate: 18, disc: 0, sub: 25000, vatc: 4500, tot: 29500 }], ...day, note: '', receive: true });
    x._ledger = { ...x.ledgerFresh(''), loaded: true, rows, ver: 1 }; x.apiAuthed = () => true; x.state.db = { ...d(), posLedgerV: 1 };
    const refAt = r => (r.cells.find(c => /^(BL|POS)-/.test(c.t)) || {}).t, iso = r => x.toIso(r.cells[0].t), sorted = T => { const L = T.fullRows ? T.fullRows() : T.rows; return L.every((r, i) => !i || iso(L[i - 1]) >= iso(r)); };
    x.go('stok', 'Lëvizjet'); const t = x.pageTable('Lëvizjet');
    eq([x.view().movements.length, t.rows.length, t.hasMore, refAt(t.rows[0]), sorted(t)], [d().movements.length + 720, 500, true, bl, true], 'P2: Lëvizjet (ledger mode) — newest by date: today\'s purchase is the first row, not row 721 behind August\'s POS rows');
    x.go('stok', 'Hyrje në stok'); const th = x.pageTable('Hyrje në stok'); x.go('stok', 'Dalje nga stok'); const tl = x.pageTable('Dalje nga stok'), outs = x.view().movements.filter(m => m.qm < 0).map(m => x.toIso(m.date)).sort();
    eq([refAt(th.rows[0]), sorted(th), iso(tl.rows[0]), sorted(tl)], [bl, true, outs[outs.length - 1], true], 'P2: Hyrje në stok / Dalje nga stok — newest by date as well');
    const mv = [{ date: '01.09.2026', ref: 'a' }, { date: '02.09.2026', ref: 'b' }, { date: '01.09.2026', ref: 'c' }], s1 = x.mvNewest(mv), same = x.mvNewest(mv) === s1; mv.push({ date: '02.09.2026', ref: 'd' });
    eq([s1.map(m => m.ref), same, x.mvNewest(mv).map(m => m.ref)], [['b', 'c', 'a'], true, ['d', 'b', 'c', 'a']], 'P2: mvNewest — by date, ties: the later row first; memoised per array and length (follows a push)'); });
  // P3 — pro-rata recipe restock (credit notes, partial POS cancels): rounded once per ingredient / warehouse / cost and cumulatively — all of them together give back exactly what went out
  blk('P3', () => { const x = mkC(), d = () => x.state.db, cu = d().customers[0];
    x.addProduct(P('RUM', 'Rum', 'l', 7000, 2000)); x.addProduct(P('MOJ', 'Mojito', 'gotë', 0, 0, { price_c: 500, recipe: [{ sku: 'RUM', qm: 45 }] }));
    x.addProduct(P('SIR', 'Shurup', 'l', 7000, 300)); x.addProduct(P('LMD', 'Limonadë', 'l', 0, 0, { price_c: 500, recipe: [{ sku: 'SIR', qm: 1 }] }));
    const r0 = x.stockOf('RUM'), [n1] = x.issueBatch([{ cust: cu, items: [il(x, 'MOJ', 1, 500), il(x, 'MOJ', 1, 500)], note: '' }], 'issue', day), k1 = ret(x, 'sale', n1, [{ li: 0, qty: 1 }]), k2 = ret(x, 'sale', n1, [{ li: 1, qty: 1 }]);
    eq([mvR(x, n1).map(m => m[2]), mvR(x, k1).map(m => m[2]), mvR(x, k2).map(m => m[2]), x.stockOf('RUM') - r0], [[-45, -45], [45], [45], 0], 'P3: the same cocktail on two lines (45 ml each) returned in two notes → 45 + 45 back (one movement per ingredient), net 0 — not 46 + 46');
    const s0 = x.stockOf('SIR'), [n2] = x.issueBatch([{ cust: cu, items: [il(x, 'LMD', 1.5, 500)], note: '' }], 'issue', day), ks = [0, 1, 2].map(() => ret(x, 'sale', n2, [{ li: 0, qty: 0.5 }]));
    eq([mvR(x, n2).map(m => m[2]), ks.map(k => mvR(x, k).map(m => m[2])), x.stockOf('SIR') - s0], [[-2], [[1], [], [1]], 0], 'P3: 1.5 l (2 ml of syrup out) returned in three thirds → 1 + 0 + 1 back (cumulative), never 1 + 1 + 1');
    x.cancelReturn(ks[0]); const k4 = ret(x, 'sale', n2, [{ li: 0, qty: 0.5 }]);
    eq([mvR(x, k4).map(m => m[2]), x.stockOf('SIR') - s0], [[1], 0], 'P3: a cancelled note no longer counts — the next note brings back what is still out');
    const s1 = x.stockOf('SIR'); x.importPosSales([rcpt('lm', 'POS-0001/000500', 'final', 'fiscalized_sim', [kit('LMD', 15000)], 797, 0)], []);
    for (const k of [1, 2, 3]) x.importPosSales([rcpt('lmc' + k, 'POS-0001/00050' + k, 'cancel', 'fiscalized_sim', [kit('LMD', 5000)], 266, 0, { orig_id: 'lm' })], []);
    eq([mvR(x, 'POS-0001/000500').map(m => m[2]), [1, 2, 3].map(k => mvR(x, 'POS-0001/00050' + k).map(m => [m[0], m[2]])), x.stockOf('SIR') - s1], [[-2], [[['sale_cancel', 1]], [], [['sale_cancel', 1]]], 0], 'P3: three partial POS cancels (0.5 of 1.5 l each) → 1 + 0 + 1 of the 2 ml that went out');
    const m0 = x.stockOf('RUM'); x.importPosSales([rcpt('mj', 'POS-0001/000510', 'final', 'fiscalized_sim', [kit('MOJ', 10000), kit('MOJ', 10000)], 1000, 0)], []);
    x.importPosSales([rcpt('mjc', 'POS-0001/000511', 'cancel', 'fiscalized_sim', [kit('MOJ', 10000)], 500, 0, { orig_id: 'mj' })], []); x.importPosSales([rcpt('mjc2', 'POS-0001/000512', 'cancel', 'fiscalized_sim', [kit('MOJ', 10000)], 500, 0, { orig_id: 'mj' })], []);
    eq([mvR(x, 'POS-0001/000510').map(m => m[2]), mvR(x, 'POS-0001/000511').map(m => m[2]), mvR(x, 'POS-0001/000512').map(m => m[2]), x.stockOf('RUM') - m0], [[-45, -45], [45], [45], 0], 'P3: a POS receipt with the cocktail on two lines cancelled in two parts → 45 + 45 (once per ingredient), net 0'); });
  // P4 — a purchase return (KD) leaves the warehouse the purchase brought the goods into
  blk('P4', () => { const x = mkC(), d = () => x.state.db, sup = d().suppliers[0].name;
    const bl = x.createPurchase({ supplier: sup, items: [{ name: 'Ndriçues LED 18W', sku: 'LED-18', unit: 'copë', qty: 10, unit_c: 500, rate: 18, disc: 0, sub: 5000, vatc: 900, tot: 5900 }], ...day, note: '', receive: true, wh: 'W2' });
    const w1 = x.stockOfWh('LED-18', 'W1'), w2 = x.stockOfWh('LED-18', 'W2'), kd = ret(x, 'purchase', bl, [{ li: 0, qty: 10 }]);
    eq([mvR(x, kd), x.stockOfWh('LED-18', 'W1') - w1, x.stockOfWh('LED-18', 'W2') - w2], [[['purchase_return', 'LED-18', -10000, '', 500, 'W2']], 0, -10000], 'P4: the purchase return (KD) leaves W2 — the purchase\'s warehouse — not the main warehouse'); });
  // P5 — R:Shitje › Sipas artikullit nets the cost of credit notes and of the book's POS returns / cancels exactly as it nets their revenue
  blk('P5', () => { const x = mkC(), d = () => x.state.db, cu = d().customers[0];
    for (const p of [P('VOD', 'Vodka', 'l', 7000, 1200), P('LIM', 'Limon', 'copë', 20000, 10), P('KOK', 'Koktej', 'gotë', 0, 0, { recipe: [{ sku: 'VOD', qm: 40 }, { sku: 'LIM', qm: 500 }] }), P('TS1', 'Test 1', 'copë', 10000, 77), P('TS2', 'Test 2', 'copë', 10000, 55)]) x.addProduct(p);
    const [n] = x.issueBatch([{ cust: cu, items: [il(x, 'VOD', 0.5, 2500), il(x, 'KOK', 3), il(x, 'KOK', 2), il(x, 'VOD', 0.25, 2500)], note: '' }], 'issue', { ...day, wh: 'W2' });
    const k1 = ret(x, 'sale', n, [{ li: 0, qty: 0.5 }, { li: 2, qty: 2 }]); ret(x, 'sale', n, [{ li: 1, qty: 3 }, { li: 3, qty: 0.25 }]); x.cancelReturn(k1);
    x.importPosSales([rcpt('p5a', 'POS-0001/000600', 'final', 'fiscalized_sim', [it('TS1', 'Test 1', 2000, 890)], 2100, 0), rcpt('p5b', 'POS-0001/000601', 'return', 'fiscalized_sim', [it('TS1', 'Test 1', -1000, 890)], -1050, 0, { orig_id: 'p5a' })], []);
    x.importPosSales([rcpt('p5c', 'POS-0001/000602', 'final', 'fiscalized_sim', [it('TS2', 'Test 2', 3000, 145)], 513, 0)], []); x.importPosSales([{ ...rcpt('p5d', 'POS-0001/000603', 'cancel', 'fiscalized_sim', [], 0, 0, { orig_id: 'p5c' }), sub_c: 0, vat_c: 0, total_c: 0 }], []);
    x.state.rp = 'all'; x.state.rTab = 'Sipas artikullit'; const t = x.pageTable('R:Shitje'), r = sku => (t.rows.find(z => z.cells[1].t === sku) || { cells: [] }).cells.slice(2, 5).map(c => c.t);
    eq([r('VOD'), r('KOK'), r('TS1'), r('TS2')], [['0.5 l', x.fmt(1250), x.fmt(600)], ['2 gotë', x.fmt(900), x.fmt(106)], ['1 copë', x.fmt(890), x.fmt(77)], ['0 copë', x.fmt(0), x.fmt(0)]], 'P5: by article the cost is netted like the revenue — credit notes (Vodka 0.75 − 0.25 l, Koktej 5 − 3 incl. its ingredients), a POS return, a cancelled POS receipt');
    eq(t.foot[5].t, t.kpis[2].value, 'P5: the article rows\' gross profit equals the report\'s (every cost of goods netted by its document)'); });
}
// ══ ERP · paketimi (pack = {unit, qm}): blerjet, porositë e blerjes, transferimet dhe numërimi mund të shkruhen në paketime (12 shishe, çmimi për
// shishe); ruhen gjithmonë në njësinë e produktit (sasia × qm / 1000, çmimi për njësi = çmimi i paketimit × 1000 / qm, 4 decimale + centë) ══
{ const x = new C({}); x.state.db = x.seedDb(); Object.assign(x.state, { dr: null, frm: null, drawer: null, admin: false, toast: null });
  const d = () => x.state.db, sup = d().suppliers[0].name, xf = k => x.formVals().fields.find(f => f.key === k), xt = (k, v) => xf(k).set({ target: { value: v } });
  const blk = (name, f) => { try { f(); } catch (e) { console.log('FAIL ' + name + ' threw: ' + (e && e.stack || e)); process.exitCode = 1; } };
  const pl = (sku, qty, o = {}) => ({ ...x.newLine(), fresh: false, artOpen: false, sku, artQ: (x.prodOf(d(), sku) || {}).name, tax: 'E', qty, ...o });
  const buy = (lines, o = {}) => { x.openForm('purchase', { supplier: sup, supplierQ: sup, lines, receive: true, ...o }); const v = x.formVals(); return v; };
  x.addProduct(P('RUM', 'Rum', 'l', 10000, 2000, { pack: { unit: 'shishe', qm: 700 } })); x.addProduct(P('BIR', 'Birrë', 'copë', 48000, 60, { pack: { unit: 'pako', qm: 24000 } }));
  blk('pack helpers', () => {
    eq([x.packError({ unit: 'shishe', qm: 700 }, 'l'), x.packError(null, 'l'), /njësinë e paketimit/.test(x.packError({ unit: ' ', qm: 700 }, 'l')), /më e madhe se 0/.test(x.packError({ unit: 'shishe', qm: 0 }, 'l')), /më e madhe se 0/.test(x.packError({ unit: 'shishe', qm: 0.5 }, 'l')), /më e madhe se 0/.test(x.packError({ unit: 'shishe', qm: -700 }, 'l')), /tjetër nga njësia/.test(x.packError({ unit: 'l', qm: 700 }, 'l')), /numra të plotë/.test(x.packError({ unit: 'pako', qm: 1500 }, 'copë'))],
      ['', '', true, true, true, true, true, true], 'packError: unit non-empty, qm an integer > 0 (thousandths), another unit than the product\'s, whole for a whole-number unit');
    eq([x.packOf(x.prodOf(d(), 'RUM')), x.packOf(x.prodOf(d(), 'LED-18')), x.packOf({ ...x.prodOf(d(), 'RUM'), pack: { unit: 'l', qm: 700 } }), x.packOf({ ...x.prodOf(d(), 'RUM'), recipe: [{ sku: 'LED-18', qm: 1000 }] })], [{ unit: 'shishe', qm: 700 }, null, null, null], 'packOf: a valid pack; none without one, for an invalid one or on a recipe');
    eq([x.packEq(x.prodOf(d(), 'RUM'), 8400), x.packEq(x.prodOf(d(), 'RUM'), 1000), x.packEq(x.prodOf(d(), 'BIR'), 48000), x.packEq(x.prodOf(d(), 'LED-18'), 5000), x.packNote({ unit: 'shishe', qm: 700, n_q: 12000 }, 'l')], ['≈ 12 shishe', '≈ 1.43 shishe', '≈ 2 pako', '', '12 shishe × 0.7 l'], 'packEq / packNote: 8.4 l ≈ 12 shishe, 1 l ≈ 1.43 shishe; nothing without a pack');
    x.state.toast = null; eq([x.updateProduct('RUM', { pack: { unit: '', qm: 700 } }), /Paketimi/.test(x.state.toast || ''), x.updateProduct('RUM', { pack: { unit: 'shishe', qm: 0 } }), x.updateProduct('RUM', { pack: { unit: 'shishe', qm: 1.5 } }), x.addProduct(P('BAD', 'Bad', 'copë', 0, 10, { pack: { unit: 'pako', qm: 2500 } })), x.prodOf(d(), 'RUM').pack, !!x.prodOf(d(), 'BAD')],
      [false, true, false, false, false, { unit: 'shishe', qm: 700 }, false], 'addProduct / updateProduct refuse an invalid pack (empty unit, qm 0 or not whole thousandths, a fraction of a whole-number unit) with a toast'); x.state.toast = null; });
  blk('pack product form', () => {
    x.openForm('product'); x.setF({ name: 'Xhin', sku: 'xh-1', cat: 'Pije', catQ: 'Pije', unit: 'l', unitQ: 'l', tax: 'E', opening: '0', minStock: '0' }); xt('cost', '10.00'); xt('price', '15.00');
    const st = () => [x.formVals().actions[0].disabled, xf('packQty').err];
    eq(st(), [false, ''], 'product form: no pack → ready');
    x.setF({ packUnit: 'shishe', packUnitQ: 'shishe', packQty: '' }); const a = st(); x.setF({ packUnit: '', packUnitQ: '', packQty: '0.7' }); const b = st(); x.setF({ packUnit: 'shishe', packUnitQ: 'shishe', packQty: '0' }); const c0 = st(); x.setF({ packQty: 'abc' }); const c1 = st(); x.setF({ packQty: '0.0005' }); const c2 = st();
    x.setF({ packUnit: 'l', packUnitQ: 'l', packQty: '0.7' }); const c3 = [...st(), /tjetër nga njësia/.test(xf('packQty').hint)];
    eq([a, b, c0, c1, c2, c3], [[true, '1'], [true, '1'], [true, '1'], [true, '1'], [true, '1'], [true, '1', true]], 'product form: the pack needs both halves; qty 0 / text / 4 decimals / the product\'s own unit are refused (save disabled, the reason as hint)');
    x.setF({ unit: 'copë', unitQ: 'copë', packUnit: 'pako', packUnitQ: 'pako', packQty: '1.5' }); const c4 = [...st(), /numra të plotë/.test(xf('packQty').hint)];
    x.setF({ unit: 'l', unitQ: 'l', packUnit: 'shishe', packUnitQ: 'shishe', packQty: '0.7' }); eq([c4, st(), xf('packQty').hint.startsWith('1 shishe = 0.7 l')], [[true, '1', true], [false, ''], true], 'product form: a whole-number unit needs a whole pack; shishe × 0.7 l is ready (hint 1 shishe = 0.7 l)');
    x.formVals().actions[0].go(); eq(x.prodOf(d(), 'XH-1').pack, { unit: 'shishe', qm: 700 }, 'product form: saved pack {unit, qm thousandths}');
    x.openProduct('XH-1'); x.drawerVals().actions[0].go(); eq([x.state.frm.packUnit, x.state.frm.packQty], ['shishe', '0.7'], 'product edit form: the pack pre-filled'); x.state.frm = null; x.state.dr = null; });
  // ── a purchase typed in packs: 12 shishe × €12.00 → 8.4 l at €17.1429 / l (€17.14), the line = 12 × 12.00 = €144.00 exactly
  let bl1 = '';
  blk('pack purchase', () => {
    let v = buy([pl('RUM', '12', { pk: true, net: '12.00' })]); let L = v.lines[0];
    eq([L.hasPack, L.packOpts.map(o => [o.label, o.on]), L.ev.qm, L.ev.packQ, L.ev.unitT, L.ev.netC, L.ev.line, L.lineHint, L.packHint, L.perLbl, L.unitHint, v.summary.subFmt, v.summary.totFmt],
      [true, [['l', ''], ['shishe (0.7 l)', '1']], 8400, 12000, 171429, 1714, { sub: 14400, disc: 0, vatc: 2592, tot: 16992 }, '12 shishe (8.4 l) ×', '= 8.4 l · €17.1429 / l', ' / shishe', '· shishe', x.fmt(14400), x.fmt(16992)],
      'purchase line in packs: 12 shishe = 8.4 l; €12.00 / shishe → €17.1429 / l (cents €17.14); the line is 12 × 12.00 = €144.00 (+ 18 %)');
    const s0 = x.stockOf('RUM'), ap0 = x.balances()['2200'].bal; v.actions[0].go(); const p = d().purchases[0]; bl1 = p.no;
    eq([p.items[0], p.sub, p.total], [{ name: 'Rum', sku: 'RUM', unit: 'l', qty: 8.4, unit_c: 1714, unit_t: 171429, rate: 18, tax: 'E', disc: 0, sub: 14400, vatc: 2592, tot: 16992, pk: { unit: 'shishe', qm: 700, n_q: 12000, price_c: 1200 } }, 14400, 16992], 'stored in the product\'s unit: qty 8.4 l, unit_c 1714 + unit_t 171429; `pk` keeps what was typed (12 shishe à €12.00)');
    const m = d().movements.filter(z => z.ref === p.no);
    eq([m.map(z => [z.type, z.sku, z.qm, z.unit_c, z.note]), Object.keys(m[0]).sort(), x.stockOf('RUM') - s0, x.balances()['2200'].bal - ap0], [[['purchase', 'RUM', 8400, 1714, '12 shishe × 0.7 l']], ['date', 'note', 'party', 'qm', 'ref', 'sku', 'type', 'unit_c', 'wh'], 8400, 16992], 'receiving: +8.4 l (base unit) at €17.14 / l, the packs only in the movement note (no new movement field); payables + €169.92');
    const r = x.prodOf(d(), 'RUM'); eq([r.cost_c, r.cost_t, x.avgCost(d(), 'RUM'), x.costT(r)], [1714, 171429, Math.round((10000 * 2000 + 8400 * 1714) / 18400), 171429], 'cost per base unit: cost_c €17.14, cost_t €17.1429; avgCost (10 l × 20.00 + 8.4 l × 17.14) / 18.4 l');
    const J = x.journal(); eq([J.reduce((a, e) => a + e.lines.reduce((s, l) => s + l[1], 0), 0) === J.reduce((a, e) => a + e.lines.reduce((s, l) => s + l[2], 0), 0), J.find(e => e.ref === p.no).lines], [true, [['1300', 14400, 0], ['2410', 2592, 0], ['2200', 0, 16992]]], 'journal: the purchase books the exact €144.00 + VAT');
    x.openDr('purchase', p.no); const row = x.drawerVals().sections[0].rows[0].cells; eq([row[2].t, row[2].sub, row[3].t, row[3].sub, row[5].t], ['8.4 l', '12 shishe × 0.7 l', '€17.1429', '€12.00 / shishe', x.fmt(16992)], 'purchase drawer: 8.4 l (12 shishe × 0.7 l), €17.1429 (€12.00 / shishe)'); x.state.dr = null;
    eq(x.docPrintHtml(p).includes('RUM · 12 shishe × 0.7 l · 12,00 € / shishe'), true, 'A4 print: the packs under the article');
    x.openProduct('RUM'); const dm = x.drawerVals().meta, mv = k => (dm.find(z => z.k === k) || {}).v; eq([mv('Gjendja'), mv('Kosto e blerjes (pa TVSH)'), mv('Paketimi')], ['18.4 l ≈ 26.29 shishe', '€17.1429', '1 shishe = 0.7 l'], 'product drawer: the stock with its pack equivalent, the cost per l with 4 decimals'); x.state.dr = null;
    x.state.section = 'stok'; x.state.page = 'Gjendja'; const g = x.pageTable('Gjendja').rows.find(z => z.cells[1].t === 'RUM').cells[3]; eq([g.t, g.sub], ['18.4 l', '≈ 26.29 shishe'], 'Gjendja: the pack equivalent under the stock');
    x.state.section = 'produkte'; x.state.page = 'Produktet'; eq([x.renderVals().products.find(z => z.sku === 'RUM').stock, x.renderVals().products.find(z => z.sku === 'LED-18').stock], ['18.4 l ≈ 26.29 shishe', '25 copë'], 'Produktet: the pack equivalent (none without a pack)'); });
  blk('pack rounding', () => {
    const L = buy([pl('RUM', '3', { pk: true, net: '10.00' })]).lines[0];
    eq([L.ev.unitT, L.ev.netC, L.ev.qm, L.ev.line.sub, x.calcLine({ unit_c: L.ev.netC, qm: L.ev.qm, rate: 18, bp: 0 }).sub], [142857, 1429, 2100, 3000, 3001], 'rounding: €10.00 / 0.7 l = €14.285714 → unit_t 142857 (Math.round, 4 decimals), unit_c 1429 (cOfT); the line stays 3 × 10.00 = €30.00 (not 2.1 l × 14.29 = 30.01)');
    const L1 = buy([pl('RUM', '0.5', { pk: true, net: '7.77', disc: '10' })]).lines[0];
    eq([L1.ev.qm, L1.ev.unitT, L1.ev.netC, L1.ev.line], [350, 111000, 1110, x.calcLine({ unit_c: 777, qm: 500, rate: 18, bp: 1000 })], 'half a bottle × €7.77, −10 %: 0.35 l, €11.10 / l; the discount / VAT on the pack amount');
    const L2 = buy([pl('RUM', '2', { pk: true, net: '', gross: '' })]).lines[0];
    eq([L2.ev.qm, L2.ev.unitT, L2.ev.netC, L2.ev.line.sub, L2.netPh], [1400, undefined, 1714, Math.round(1714 * 1400 / 1000), 'bosh = kosto e fundit (12.00 / shishe)'], 'no price typed: the product\'s cost per l (as without packs), 2 shishe = 1.4 l');
    x.openForm('purchase', { supplier: sup, supplierQ: sup, lines: [pl('RUM', '12', { pk: true })], receive: true }); x.formVals().lines[0].setGross({ target: { value: '14.16' } });
    eq([x.state.frm.lines[0].net, x.formVals().lines[0].ev.line.sub], ['12.00', 14400], 'the gross per pack typed (€14.16 @18 %) → net €12.00 per pack');
    eq([buy([pl('RUM', '0', { pk: true, net: '12.00' })]).lines[0].ev.err, buy([pl('RUM', '1.2345', { pk: true, net: '12.00' })]).lines[0].ev.err, buy([pl('RUM', '12', { pk: true, net: '12.001' })]).lines[0].ev.err], ['invalid', 'invalid', 'invalid'], 'packs: 0 / 4 decimals / a 3-decimal pack price are refused like any line');
    x.state.frm = null; });
  blk('pack switch', () => {
    x.openForm('purchase', { supplier: sup, supplierQ: sup, lines: [pl('RUM', '8.4', { net: '17.14' })], receive: true }); let L = x.formVals().lines[0];
    eq([L.packOpts.map(o => o.on), L.ev.qm, L.ev.pk, L.perLbl], [['1', ''], 8400, undefined, ''], 'in the product\'s unit by default');
    L.packOpts[1].go(); L = x.formVals().lines[0]; eq([x.state.frm.lines[0].pk, x.state.frm.lines[0].qty, x.state.frm.lines[0].net, x.state.frm.lines[0].gross, L.ev.qm, L.ev.line.sub], [true, '12', '12.00', '14.16', 8400, 14400], '"Sasia në: shishe": 8.4 l → 12 shishe, €17.14 / l → €12.00 / shishe (gross re-derived)');
    L.packOpts[0].go(); eq([x.state.frm.lines[0].pk, x.state.frm.lines[0].qty, x.state.frm.lines[0].net], [false, '8.4', '17.14'], 'and back: 8.4 l, €17.14 / l');
    x.formVals().lines[0].packOpts[1].go(); x.setFormLine(x.state.frm.lines[0].id, { sku: '', artQ: 'Bir' }); x.formVals().lines[0].opts.find(o => o.sku === 'BIR').pick({ preventDefault() {} });
    eq([x.state.frm.lines[0].sku, x.state.frm.lines[0].pk, x.formVals().lines[0].packOpts.map(o => o.on)], ['BIR', false, ['1', '']], 'picking another article starts it in its own unit (copë), its pack offered'); x.state.frm = null; });
  // ── purchase order in packs → purchase (pre-filled in packs, the same amount) → purchase return of a pack line (exact to the cent)
  blk('pack po', () => {
    x.openForm('po', { supplier: sup, supplierQ: sup, lines: [pl('RUM', '12', { pk: true, net: '12.00' })], wh: 'W1' }); x.formVals().actions[0].go(); const po = d().purchaseOrders[0];
    eq([po.items[0].qty, po.items[0].unit_t, po.items[0].sub, po.items[0].pk, x.incomingOf('RUM')], [8.4, 171429, 14400, { unit: 'shishe', qm: 700, n_q: 12000, price_c: 1200 }, 8400], 'purchase order in packs: 8.4 l "Në ardhje", the pack kept for the conversion');
    x.poToPurchase(po.no); const L = x.formVals().lines[0];
    eq([x.state.frm.lines[0].pk, x.state.frm.lines[0].qty, x.state.frm.lines[0].net, L.ev.qm, L.ev.line.sub], [true, '12', '12.00', 8400, 14400], 'PO → purchase: pre-filled in packs (12 shishe × €12.00) → the same 8.4 l / €144.00');
    x.formVals().actions[0].go(); eq([d().purchases[0].fromPo, d().purchases[0].total, d().purchaseOrders[0].status, x.incomingOf('RUM')], [po.no, 16992, 'Pranuar', 0], 'received from the PO: €169.92, PO closed');
    const prod = x.prodOf(d(), 'RUM'); x.state.db = { ...d(), products: d().products.map(z => z.sku === 'RUM' ? { ...z, pack: { unit: 'shishe', qm: 750 } } : z) };
    eq(x.linesFrom([po.items[0]])[0].pk, undefined, 'a pack changed since the order (0.75 l) → the line comes back in litres, as stored'); x.state.db = { ...d(), products: d().products.map(z => z.sku === 'RUM' ? prod : z) }; });
  blk('pack return', () => {
    const p = d().purchases.find(z => z.no === bl1), k1 = x.createReturn({ kind: 'purchase', ref: bl1, items: [{ li: 0, qty: 4.2 }], date: '2026-09-20', reason: '' }), r1 = d().returns.find(z => z.no === k1);
    eq([r1.items[0].sub, r1.items[0].vatc, r1.total], [7200, 1296, 8496], 'purchase return of half the pack line (4.2 l = 6 shishe): priced with €17.1429 / l → €72.00');
    const k2 = x.createReturn({ kind: 'purchase', ref: bl1, items: [{ li: 0, qty: 4.2 }], date: '2026-09-20', reason: '' }), r2 = d().returns.find(z => z.no === k2);
    eq([r2.total, r1.total + r2.total === p.total, d().purchases.find(z => z.no === bl1).credited], [8496, true, p.total], 'the rest of the line returns its exact remainder — the returns add up to the purchase to the cent');
    x.openForm('purchase', { supplier: sup, supplierQ: sup, lines: [pl('RUM', '1000', { pk: true, net: '10.00' })], receive: true }); x.formVals().actions[0].go(); const big = d().purchases[0];
    eq([big.items[0].qty, big.items[0].unit_t, big.sub, x.calcLine({ unit_c: big.items[0].unit_t / 100, qm: 700000, rate: 18, bp: 0 }).sub], [700, 142857, 1000000, 999999], '1000 shishe × €10.00 = €10,000.00 (700 l at €14.2857 would give €9,999.99)');
    const k3 = x.createReturn({ kind: 'purchase', ref: big.no, items: [{ li: 0, qty: 700 }], date: '2026-09-20', reason: '' }); eq([d().returns.find(z => z.no === k3).sub, d().purchases.find(z => z.no === big.no).credited === big.total], [1000000, true], 'returning the whole line: exactly what was booked (€10,000.00), not the unit-price recomputation'); });
  // ── transfer and stock count in packs
  blk('pack transfer + count', () => {
    const w1 = x.stockOfWh('RUM', 'W1'), w2 = x.stockOfWh('RUM', 'W2');
    x.openForm('transfer', { from: 'W1', to: 'W2', lines: [pl('RUM', '5', { pk: true })] }); let v = x.formVals();
    eq([v.noPrice, v.lines[0].hasPack, v.lines[0].ev.qm, v.lines[0].srcStock, v.lines[0].packHint, v.actions[0].disabled], [true, true, 3500, x.fmtQ(w1) + ' l ' + x.packEq(x.prodOf(d(), 'RUM'), w1), '= 3.5 l', false], 'transfer in packs: 5 shishe = 3.5 l, the source stock with its pack equivalent');
    x.setFormLine(x.state.frm.lines[0].id, { qty: String(Math.ceil(w1 / 700) + 1) }); v = x.formVals(); eq([v.actions[0].disabled, /ka vetëm/.test(v.msg)], [true, true], 'transfer in packs: more than the source holds is refused (checked in litres)');
    x.setFormLine(x.state.frm.lines[0].id, { qty: '5' }); x.formVals().actions[0].go(); const tr = d().transfers[0];
    eq([x.stockOfWh('RUM', 'W1') - w1, x.stockOfWh('RUM', 'W2') - w2, tr.items[0], d().movements.filter(m => m.ref === tr.no).map(m => [m.qm, m.wh, m.note])], [-3500, 3500, { name: 'Rum', sku: 'RUM', unit: 'l', qty: 3.5, pk: { unit: 'shishe', qm: 700, n_q: 5000 } }, [[-3500, 'W1', '5 shishe × 0.7 l'], [3500, 'W2', '5 shishe × 0.7 l']]], 'transfer: moved in litres, the packs in the note');
    x.openDr('transfer', tr.no); eq([x.drawerVals().sections[0].rows[0].cells[2].t, x.drawerVals().sections[0].rows[0].cells[2].sub], ['3.5 l', '5 shishe × 0.7 l'], 'transfer drawer: 3.5 l (5 shishe × 0.7 l)'); x.state.dr = null;
    const s0 = x.stockOf('RUM'); x.openForm('adjust', { art: 'RUM', artQ: 'Rum', sku: 'RUM' }); const seg = () => x.formVals().fields.find(f => f.label === 'Numërimi në');
    eq([seg().opts.map(o => [o.label, o.on]), x.formVals().fields.find(f => f.label === 'Gjendja në sistem').value], [[['l', '1'], ['shishe (0.7 l)', '']], x.fmtQ(s0) + ' l ' + x.packEq(x.prodOf(d(), 'RUM'), s0)], 'count form: "Numërimi në" l / shishe, the stock with its pack equivalent');
    xt('counted', '7'); seg().opts[1].go(); eq([x.state.frm.pk, x.state.frm.counted], [true, '10'], 'switching to packs converts what was typed (7 l → 10 shishe)');
    xt('counted', '20'); v = x.formVals(); const cf = v.fields.find(f => f.key === 'counted');
    eq([cf.label, cf.hint, v.fields.find(f => f.label === 'Diferenca').value, v.actions[0].disabled], ['Sasia e numëruar (shishe)', '= 14 l', x.fmtQ(14000 - s0) + ' l ' + x.packEq(x.prodOf(d(), 'RUM'), 14000 - s0), false], 'count in packs: 20 shishe = 14 l, the difference in litres');
    x.setF({ note: 'numërim mujor' }); x.formVals().actions[0].go(); const m = d().movements[d().movements.length - 1];
    eq([x.stockOf('RUM'), m.type, m.qm, m.note], [14000, 'adjust', 14000 - s0, 'numërim mujor · numëruar 20 shishe × 0.7 l'], 'the count is booked in litres (stock 14 l), the packs in the note'); x.state.dr = null; });
  // ── a product without a pack: exactly as before
  blk('no pack', () => {
    let v = buy([pl('LED-18', '3', { pk: true, net: '5.00' })]); const L = v.lines[0];
    eq([L.hasPack, L.packOpts, L.perLbl, L.ev.pk, L.ev.qm, L.ev.line.sub, L.lineHint], [false, [], '', undefined, 3000, 1500, '3 copë ×'], 'no pack: no switch, the quantity is the product\'s unit (a stray pk flag is ignored)');
    v.actions[0].go(); const p = d().purchases[0];
    eq([Object.keys(p.items[0]), d().movements.filter(m => m.ref === p.no).map(m => m.note), x.prodOf(d(), 'LED-18').cost_t], [['name', 'sku', 'unit', 'qty', 'unit_c', 'rate', 'tax', 'disc', 'sub', 'vatc', 'tot'], [''], undefined], 'no pack: the same item keys and movement as before (no unit_t / pk / note, no cost_t written)');
    x.openForm('adjust', { art: 'LED-18', artQ: 'LED', sku: 'LED-18' }); eq(x.formVals().fields.some(f => f.label === 'Numërimi në'), false, 'count form: no "Numërimi në" without a pack'); x.state.frm = null;
    eq([x.evalLine(pl('RUM', '12', { pk: true, net: '12.00' }), 'sale').qm, x.evalLine(pl('RUM', '12', { pk: true, net: '12.00' }), 'sale').pk], [12000, undefined], 'sales lines are never in packs (12 = 12 l)');
    x.openForm('invoice', { lines: [pl('RUM', '1')] }); eq(x.formVals().lines[0].hasPack, false, 'invoice form: no pack switch'); x.state.frm = null;
    eq('pack' in x.posCatalogPayload().products.find(z => z.sku === 'RUM'), false, 'catalogue: the pack is never sent to the tills'); });
}
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
  // T.known = receipts the server has booked ('ok'); T.rstate[id] = any other ledger_state of a receipt the server has (null / 'new' / 'dirty' /
  // 'error' / 'wait_orig' / 'excluded') — POST /pos/receipts/known answers known (ok/new/dirty/null) + states (every id the server has)
  const mkT = (id, name, state = null, mode = 'off') => (S.T[id] = { id, name, version: state ? 1 : 0, state: state && JSON.parse(JSON.stringify(state)), commits: [], tries: 0, catVersion: 0, catalogs: [], known: new Set(), knownShifts: new Set(), rstate: {}, knownCalls: [], activates: [], audit: [], resets: 0, onCommit: null, onActivate: null, notReadyAfterDone: 0, led: { epoch: 'E-' + id, top: 0, mode, notReady: 0, cap: 200, rows: new Map(), shifts: new Map() } });
  const stOf = (T, x) => (Object.prototype.hasOwnProperty.call(T.rstate, x) ? T.rstate[x] : T.known.has(x) ? 'ok' : undefined), BOOKS = ['ok', 'new', 'dirty', null];
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
    if (p === '/pos/receipts/known') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); if ((body.ids || []).length > 2000 || (body.shiftIds || []).length > 2000) return json(400, { error: 'validation_error', message: 'ids' });
      T.knownCalls.push(body); if (T.onKnown) T.onKnown(body); const seen = new Set(), ids = body.ids || [];
      return json(200, { known: ids.filter(x => BOOKS.includes(stOf(T, x)) && !seen.has(x) && seen.add(x)), knownShifts: (body.shiftIds || []).filter(x => T.knownShifts.has(x)), states: Object.fromEntries(ids.filter(x => stOf(T, x) !== undefined).map(x => [x, stOf(T, x)])) }); }
    if (p === '/pos/ledger/activate') { if (!posOk(u)) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); if ((body.receipts || []).length > 1000 || (body.legacy || []).length > 2000) return json(400, { error: 'validation_error', message: 'activate' });
      T.activates.push(body); if (T.onActivate) T.onActivate(body); for (const x of body.legacy || []) if (stOf(T, x) !== undefined) T.rstate[x] = 'excluded'; // legacy: excluded for good, never booked
      if (body.done) { T.led.mode = 'on'; T.led.notReady = T.notReadyAfterDone; } return json(200, { updated: (body.receipts || []).filter(r => BOOKS.includes(stOf(T, r.id))).length, mode: T.led.mode }); }
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
    if (p === '/api-keys' || p.startsWith('/api-keys/')) { if (S.akHold && m === 'GET') await S.akHold.p; if (u.role !== 'Pronar' && !u.perms.kompania) return json(403, { error: 'forbidden', message: 'Nuk keni leje' }); T.keys = T.keys || [];
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
    eq(T3.activates, [{ receipts: [{ id: 'rC', costs: { KAFE: mvOf('BAR-1/0003').unit_c }, noVat: false, wh: 'W2', cash: 'cash1' }, { id: 'rB', costs: { UJE: 20 }, noVat: false, wh: 'W2', card: 'bank1' }, { id: 'rA', costs: { KAFE: 30 }, noVat: false, wh: 'W2', cash: 'cash1' }] }, { legacy: ['rL'] }, { done: true }], 'migration: activate with the book\'s frozen cost per sku, no-VAT rule, warehouse and cash/card accounts, the receipt the server does not have yet (rL) as `legacy` (a later push of it is never counted), then {done:true}');
    eq([known.length, S.mid], [3, [[K0, C0, true], [K0, C0, true], [K0, C0, true], [K0, C0, true]]], 'migration: at known, at activate (receipts, legacy) and at done the page still shows the old book alone (no double counting)');
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
  return { S, users, mkT, pub, pubShift, tomb, calls, json, jOf, mk, enter, done, wait, until, store, mem, book, TERM, line, row, SHIFT, legacyBook, mig, day17, day20 }; // for the E-L2 block and the review block below
}).catch(e => { console.log('FAIL POS ledger tests threw: ' + (e && e.stack || e)); process.exitCode = 1; })
// ══ Faza B · E-L2 (API mode, POS ledger): the server's receipts one by one (GET /pos/receipts[/{id}]) on P:Shitje / P:Kthime / the fiscal monitor
// and in the receipt drawer, the day-summary drawer, the pages derived from the ledger rows, the A4 invoice from a server receipt, the server's
// API keys and the terminal token rotation; ensurePins stable; feature-off / local mode as before. Runs after the ledger block (same mock server). ══
  .then(async (H) => { if (!H) { console.log('FAIL E-L2 tests skipped: the POS ledger block did not finish'); process.exitCode = 1; return; }
    const { S, users, mkT, pub, pubShift, calls, mk, enter, done, wait, until, store, mem, book, TERM, line, row, SHIFT, legacyBook } = H;
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
      eq([rcOf('t9', k1).length, Td.count, Td.rows.length], [2, '62', 50], '"Rifresko" asks again');
      // back on the page after another one: the list kept from the last visit is read again (a receipt made meanwhile shows), its rows stay while it loads
      const s8 = rcv(pay('s8', 'BAR-1/0018', 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { time: '19:00:00' })); T9.rc.push(s8);
      R.go('dashboard', 'Paneli'); await settle(R); const h = defer(), k2 = S.calls.length; S.rcHold = (tid, path) => (path.startsWith('/pos/receipts?') ? h.p : null);
      R.go('pos', 'Shitje'); await until(() => R.state.posList.busy); const Tb = R.pageTable('P:Shitje'); S.rcHold = null; h.open(); await settle(R); const Ta = R.pageTable('P:Shitje');
      eq([rcOf('t9', k2), Tb.rows.length, Tb.rows[0].cells[0].t, Ta.count, Ta.rows[0].cells[0].t], [['GET /pos/receipts?' + Q31 + ST + '&limit=50&offset=0'], 50, 'BAR-2/0001', '63', 'BAR-1/0018'], 'back on P:Shitje: the list is read again (the rows of the last visit stay while it loads)');
      T9.rc.pop(); Ta.actions.find(a => a.label === 'Rifresko').go(); await settle(R); eq(R.pageTable('P:Shitje').count, '62', 'P:Shitje: refreshed'); }
    // ── the receipt drawer: GET /pos/receipts/{id} (+ related), a full loading object, related receipts clickable, late answers dropped
    const metaOf = D => D.meta.map(m => [m.k, m.v]), secOf = D => D.sections.map(s => [s.title, s.rows.map(cellsT)]);
    { const hold = defer(); S.rcHold = (tid, path) => (path === '/pos/receipts/s2' ? hold.p : null);
      const k0 = S.calls.length; R.pageTable('P:Shitje').rows.find(r => r.cells[0].t === 'BAR-1/0012').open(); await wait(); let D = R.drawerVals();
      eq([R.state.dr, R.state.posRc.busy, D.title, D.no, D.badge.text, D.meta.length > 0, rcOf('t9', k0)], [{ kind: 'posApi', id: 's2' }, true, 'Drini Market SH.P.K.', 'BAR-1/0012', 'Në rregull', true, ['GET /pos/receipts/s2']], 'receipt drawer: opens at once with the list row while GET /pos/receipts/{id} is on its way');
      S.rcHold = null; hold.open(); await settle(R); D = R.drawerVals();
      eq([D.subtitle, lab(D.actions), metaOf(D)], ['Kupon POS · Arka Bar · Qendra · Besa', ['Gjenero faturë A4 nga kuponi', 'Statuset fiskale'], [['Data / ora', '20.09.2026 11:00'], ['NUI e blerësit', '811234500'], ['Fiskalizimi', 'Në pritje'], ['Referenca fiskale', '—'], ['Konfigurimi fiskal', 'ATK_ELECTRONIC · v3'], ['Para', '€2.00 (kusur €0.50)'], ['Kartë', '€4.00'], ['Ndërrimi', 'SH-9'], ['Libri i POS-it', 'regjistruar në librin e POS-it'], ['Pranuar nga serveri', R.isoStamp('2026-09-20T11:00:00Z')]]],
        'receipt drawer: the server\'s receipt — buyer NUI, fiscal fields, cash / card, shift, the ledger state; "Gjenero faturë A4" for a Finalizuar receipt');
      eq([secOf(D), D.totals.map(t => [t.k, t.v])], [[['Artikujt', [['Kafe', 'KAFE', R.fmtQ4(20000) + ' copë', R.fmtT(12700), '—', 'E · 18%', '€3.00'], ['Ujë', 'UJE', R.fmtQ4(30000) + ' shishe', R.fmtT(8467), '10%', 'E · 18%', '€3.00']]], ['Pagesat (të regjistruara nga serveri)', [['Arka 2', 'Para', '€2.00'], ['Banka', 'Kartë', '€4.00']]]], [['Neto', '€5.08'], ['TVSH', '€0.92'], ['Totali', '€6.00']]], 'receipt drawer: frozen lines, the payments with the frozen accounts, totals');
      R.pageTable('P:Shitje').rows.find(r => r.cells[0].t === 'BAR-1/0010').open(); await settle(R); D = R.drawerVals();
      eq([D.subtitle, lab(D.actions), secOf(D)[2], D.sections[2].rows[0].cells[2].sub, D.sections[2].rows[0].cursor, D.history.map(h => h.a).includes('Kthime: BAR-1/0011')], ['Kupon POS · me kthim · Arka Bar · Qendra · Ana', ['Kthimi BAR-1/0011', 'Statuset fiskale'], ['Kuponët e lidhur', [['BAR-1/0011', '20.09.2026 09:30', 'Kthyer', '-€1.50']]], 'Kthim', 'pointer', true], 'receipt drawer: a returned sale — no A4, the return as a related receipt (clickable) and an action');
      const k1 = S.calls.length; D.sections[2].rows[0].go(); await settle(R); D = R.drawerVals();
      eq([rcOf('t9', k1), R.state.dr.id, D.no, D.subtitle, lab(D.actions), secOf(D)[2]], [['GET /pos/receipts/r1'], 'r1', 'BAR-1/0011', 'Kupon kthimi i BAR-1/0010 · Arka Bar · Qendra · Ana', ['Kuponi origjinal BAR-1/0010', 'Statuset fiskale'], ['Kuponët e lidhur', [['BAR-1/0010', '20.09.2026 09:00', 'Kthyer', '€3.00']]]], 'receipt drawer: a click on a related receipt opens it (GET /pos/receipts/r1)');
      const k2 = S.calls.length; D.actions[0].go(); await settle(R); eq([rcOf('t9', k2), R.drawerVals().no], [['GET /pos/receipts/s1'], 'BAR-1/0010'], 'receipt drawer: "Kuponi origjinal" opens the original');
      // without a list row: a full loading object (the drawer stays open), then the server's receipt
      const h2 = defer(); S.rcHold = (tid, path) => (path === '/pos/receipts/c3' ? h2.p : null); R.openPosReceipt('c3'); await wait(); D = R.drawerVals();
      eq([!!R.state.dr, D.title, D.subtitle, D.badge.text, D.actions, D.meta, D.sections, D.totals], [true, 'Kuponi POS', 'Duke e ngarkuar nga serveri…', 'Po ngarkohet', [], [], [], []], 'receipt drawer opened by id: a full loading object while it loads');
      S.rcHold = null; h2.open(); await settle(R); D = R.drawerVals();
      eq([D.subtitle, D.badge.text, lab(D.actions), metaOf(D).find(m => m[0] === 'Arsyeja e anulimit'), secOf(D)[1], D.totals.map(t => t.v)], ['Anulim i kuponit BAR-1/0013 (ATK CANCEL) · Arka Bar · Qendra · Ana', 'Anuluar', ['Kuponi origjinal BAR-1/0013', 'Statuset fiskale'], ['Arsyeja e anulimit', 'Gabim në porosi'], ['Pagesat (të regjistruara nga serveri)', [['Arka Bar', 'Para', '-€1.00']]], ['-€0.85', '-€0.15', '-€1.00']], 'receipt drawer: a cancel (ATK CANCEL) mirrored by the server — reason, negative payment and totals');
      R.openPosReceipt('s3'); await settle(R); D = R.drawerVals(); eq([D.subtitle, lab(D.actions)], ['Kupon POS · anuluar me BAR-1/0014 · Arka Bar · Qendra · Ana', ['Anulimi BAR-1/0014', 'Statuset fiskale']], 'receipt drawer: a voided original links its cancel');
      R.openPosReceipt('s4'); await settle(R); D = R.drawerVals(); eq([metaOf(D).find(m => m[0] === 'Libri i POS-it'), D.sections.map(s => s.title), lab(D.actions)], [['Libri i POS-it', 'në përpunim në server'], ['Artikujt'], ['Gjenero faturë A4 nga kuponi', 'Statuset fiskale']], 'receipt drawer: a receipt the server has not booked yet — no frozen payments, said so');
      R.openPosReceipt('nope'); await settle(R); D = R.drawerVals();
      eq([!!R.state.dr, D.subtitle, D.badge.text, lab(D.actions)], [true, 'Kuponi nuk u gjet në server', 'Gabim', ['Provo përsëri']], 'receipt drawer: 404 → the error in the open drawer, "Provo përsëri"');
      const k3 = S.calls.length; D.actions[0].go(); await settle(R); eq(rcOf('t9', k3), ['GET /pos/receipts/nope'], '"Provo përsëri" asks again');
      // a late answer for another receipt is dropped
      const hA = defer(), hB = defer(); S.rcHold = (tid, path) => (path === '/pos/receipts/s5' ? hA.p : path === '/pos/receipts/s6' ? hB.p : null);
      R.openPosReceipt('s5'); R.openPosReceipt('s6'); hB.open(); await until(() => R.state.posRc && !R.state.posRc.busy); hA.open(); await wait(20); S.rcHold = null;
      eq([R.state.dr.id, R.state.posRc.id, R.state.posRc.item.id, R.drawerVals().no], ['s6', 's6', 's6', 'BAR-2/0001'], 'receipt drawer: the late answer of the receipt opened before is dropped');
      R.setState({ dr: null }); }
    // ── a day summary (one terminal-day of the ledger): its own drawer, "Shiko kuponat e ditës", no A4; a receipt row opens like the server's receipts
    { R.openDr('pos', L1.id); let D = R.drawerVals();
      eq([R.state.dr, D.title, D.subtitle, D.no, D.badge.text, lab(D.actions)], [{ kind: 'pos', id: L1.id }, 'Përmbledhje ditore · Arka Bar', '20.09.2026 · Qendra · 6 kupona · 08:10–21:40', L1.no, 'Përmbledhje', ['Shiko kuponat e ditës']], 'summary drawer: one terminal-day — receipts, first–last time; the only action is "Shiko kuponat e ditës" (no A4)');
      eq(metaOf(D), [['Data', '20.09.2026'], ['Arka', 'Arka Bar · BAR-1'], ['Kupona gjithsej', '6'], ['Shitje', '4'], ['Kthime', '1'], ['Anulime', '1'], ['Të anuluara', '1'], ['Fiskalizimi', 'Fiskalizuar'], ['Para', '€4.00'], ['Kartë', '€0.00']], 'summary drawer: the counts (sales / returns / cancels / voided), fiscal state, cash / card');
      eq([secOf(D).map(s => s[0]), secOf(D)[0][1], secOf(D)[1][1], secOf(D)[2][1].length, secOf(D)[3][1], D.totals.map(t => t.v), D.hasNote], [['Operatorët', 'Fiskalizimi', 'Artikujt (neto e ditës)', 'Pagesat'], [['Ana', '6', '€4.00', '-€1.50', '-€1.00']], [['Fiskalizuar', '6']], 2, [['POS-20260920-k1a2b3', 'Arka Bar', 'Arkë', '€4.00']], ['€3.39', '€0.61', '€4.00'], true], 'summary drawer: operators (net, returns, cancels), fiscal counts, items, the derived payments, totals');
      const k0 = S.calls.length; D.actions[0].go(); await settle(R); const T = R.pageTable('P:Shitje');
      eq([R.state.section, R.state.page, R.state.dr, rcOf('t9', k0), T.count, T.period.filter(p => p.on).map(p => p.label), T.filters.find(f => f.title === 'Arka').value], ['pos', 'Shitje', null, ['GET /pos/receipts?from=2026-09-20&to=2026-09-20&terminal=' + TERM.key + ST + '&limit=50&offset=0'], '6', ['20.09.2026'], TERM.key], '"Shiko kuponat e ditës" → P:Shitje filtered by that terminal and that date');
      R.openDr('pos', L3.id); D = R.drawerVals(); const fo = D.sections.find(s => s.title === 'Kuponët pa u fiskalizuar');
      eq([D.badge.text, D.badge.bg === R.st('Dështoi').bg, metaOf(D).find(m => m[0] === 'Fiskalizimi'), fo && fo.rows.map(cellsT), fo && fo.rows[0].cursor], ['1 pa fiskalizuar', true, ['Fiskalizimi', 'Dështoi'], [['BAR-2/0001', '18:00', 'Dështoi', 'ATK: timeout']], 'pointer'], 'summary drawer: the receipts not fiscalized (with the error) are listed and clickable');
      const k1 = S.calls.length; fo.rows[0].go(); await settle(R); eq([R.state.dr, rcOf('t9', k1), R.drawerVals().no], [{ kind: 'posApi', id: 's6' }, ['GET /pos/receipts/s6'], 'BAR-2/0001'], 'summary drawer: a receipt not fiscalized opens from the server');
      const k2 = S.calls.length; R.openDr('pos', 'R:s2'); await settle(R); eq([R.state.dr, rcOf('t9', k2), R.drawerVals().title], [{ kind: 'posApi', id: 's2' }, ['GET /pos/receipts/s2'], 'Drini Market SH.P.K.'], 'a ledger receipt row (buyer NUI) opens as the server\'s receipt');
      R.setState({ dr: { kind: 'pos', id: 'R:s2' } }); eq([R.drawerVals().no, lab(R.drawerVals().actions)[0]], ['BAR-1/0012', 'Gjenero faturë A4 nga kuponi'], 'the drawer of a ledger receipt row is the server receipt\'s drawer');
      R.setState({ dr: null }); }
    // ── pages derived from the ledger rows in memory (no API call): P:Arkat today, Cilësime › POS, P:Operatorët, dashboard, R:POS, Mbyllja e arkës
    { const k0 = S.calls.length; R.go('pos', 'Arkat'); await settle(R); const T = R.pageTable('P:Arkat');
      eq([T.cols.length, T.rows.map(r => [r.cells[0].t, r.cells[7].t, r.cells[8].t, r.cells[11].t]), T.kpis.map(k => k.label), T.kpis[1].sub, T.kpis[3].value], [12, [['Arka Bar', '7', '€10.00', 'Rigjenero tokenin'], ['Arka 2', '1', '€1.50', 'Rigjenero tokenin']], ['Terminale', 'Libri i POS-it në server', 'Katalogu në server', 'Kupona në përpunim'], 'rev ' + R._ledger.rev + ' · lexohet çdo 15 s', '0'],
        'P:Arkat (ledger): today per terminal by the terminal key — receipts = the rows\' n (day 6 + buyer-NUI receipt 1), sales; "Rigjenero tokenin"');
      R.go('settings', 'POS'); const P = R.settingsPage('POS'), sync = P.cards.find(c => c.title === 'Sinkronizimi përmes serverit'), terms = P.cards.find(c => c.title === 'Terminalet');
      eq([sync.rows.find(r => r.k === 'Libri i POS-it në server').v, terms.table.rows.map(r => [r.cells[0].t, r.cells[6].t])], ['5 rreshta · 2 ndërrime · i përpunuar · këtë muaj 63 kupona · ' + R.fmt(9400), [['Arka Bar', '€10.00'], ['Arka 2', '€84.00']]], 'Cilësime › POS: this month\'s receipts / sales from the ledger rows; per terminal by the terminal key');
      // a new terminal that took over an old POS ID (the old one deleted): the ledger's documents stay with the terminal KEY they were made on
      const tNew = { id: 'k9new', name: 'Arka 2 e re', branch: 'Qendra', posId: 'BAR-2', warehouse: 'W1', status: 'Aktiv', lastSeen: '', online: false }, terms0 = R.state.db.terminals; R.setState(s => ({ db: { ...s.db, terminals: [...terms0, tNew] } }));
      R.go('pos', 'Arkat'); const Tn = R.pageTable('P:Arkat'), Pn = R.settingsPage('POS'); R.setState(s => ({ db: { ...s.db, terminals: terms0 } }));
      eq([Tn.rows.map(r => [r.cells[0].t, r.cells[7].t, r.cells[8].t]), Pn.cards.find(c => c.title === 'Terminalet').table.rows.map(r => [r.cells[0].t, r.cells[6].t])], [[['Arka Bar', '7', '€10.00'], ['Arka 2', '1', '€1.50'], ['Arka 2 e re', '0', '€0.00']], [['Arka Bar', '€10.00'], ['Arka 2', '€84.00'], ['Arka 2 e re', '€0.00']]], 'P:Arkat / Cilësime › POS: a terminal reusing a POS ID gets none of the old terminal\'s ledger documents');
      R.go('pos', 'Operatorët'); R.state.rp = 'month'; let O = R.pageTable('P:Operatorët'); const nums = r => r.cells.slice(6).map(c => c.t);
      eq([O.cols.length, O.period.map(p => p.label + (p.on ? '*' : '')), O.rows.map(r => [r.cells[0].t, ...nums(r)]), O.foot.map(c => c.t), / Shitjet: libri i POS-it në server · Shtator 2026\.$/.test(O.sub)], [12, ['Ky muaj*', 'Muaji i kaluar', 'Ky vit', 'Gjithçka'],
        [['Arben Berisha', '0', '€0.00', '—', '—', '€0.00', '0'], ['Fjolla Kastrati', '0', '€0.00', '—', '—', '€0.00', '0'], ['Gent', '55', '€82.50', '—', '—', '€82.50', '1'], ['Besa', '2', '€7.50', '—', '—', '€7.50', '0'], ['Ana', '6', '€6.50', '-€1.50', '-€1.00', '€4.00', '1']],
        ['Gjithsej', '', '', '', '', '', '63', '€96.50', '-€1.50', '-€1.00', '€94.00', ''], true], 'P:Operatorët (ledger): the rows\' operators summed over the month (sales, returns, cancels, net, shifts); till operators who are no ERP user get a row of their own');
      eq([O.rows[2].cells[0].sub, O.rows[0].cells[5].t, O.rows[2].cells[1].t], ['nga arka · jo përdorues i ERP-së', 'Ndrysho PIN', '—'], 'P:Operatorët: the ERP users keep their PIN action; a till-only operator is marked');
      O.period.find(p => p.label === 'Muaji i kaluar').go(); O = R.pageTable('P:Operatorët');
      eq([O.rows.map(r => [r.cells[0].t, ...nums(r)]), O.foot[6].t], [[['Arben Berisha', '0', '€0.00', '—', '—', '€0.00', '0'], ['Fjolla Kastrati', '0', '€0.00', '—', '—', '€0.00', '0'], ['Ana', '2', '€3.00', '—', '—', '€3.00', '0']], '2'], 'P:Operatorët: "Muaji i kaluar" → August\'s row only');
      R.setState({ rp: 'all' }); O = R.pageTable('P:Operatorët'); eq([O.rows.find(r => r.cells[0].t === 'Ana').cells.slice(6).map(c => c.t), O.foot[6].t, O.foot[10].t], [['8', '€9.50', '-€1.50', '-€1.00', '€7.00', '1'], '65', '€97.00'], 'P:Operatorët: "Gjithçka" sums every row');
      R.setState({ rp: 'month', rTab: '' }); const RP = R.pageTable('R:POS');
      eq([RP.count, RP.kpis.map(k => k.value), RP.kpis[0].sub, RP.rows.map(cellsT)], ['2', ['€92.50', '€88.50', '€4.00', '-€0.50'], '62 kupona', [['SH-9', '20.09.2026', 'Arka Bar', 'Ana', '08:00 – —', '7', '€6.00', '€4.00', '€10.00', '—', 'Në proces'], ['SH-2', '05.09.2026', 'Arka 2', 'Gent', '08:00 – 20:00', '55', '€82.50', '€0.00', '€82.50', '-€0.50', 'Në rregull']]],
        'R:POS (ledger): the ledger shifts with their own totals (receipts, cash, card, total) — no grouping of receipts by shift');
      R.setState({ rTab: 'Sipas operatorit' }); eq(R.pageTable('R:POS').rows.map(r => [r.cells[0].t, r.cells[2].t, r.cells[5].t]).sort(), [['Ana', '7', '€10.00'], ['Gent', '55', '€82.50']], 'R:POS by operator from the shift totals'); R.setState({ rTab: '' });
      eq(R.pageTable('P:Raportet e arkës').kpis.map(k => k.value), ['€92.50', '€88.50', '€4.00', '-€0.50'], 'P:Raportet e arkës = R:POS');
      const MB = R.pageTable('P:Mbyllja e arkës');
      eq([MB.cols.map(c => c.label), MB.rows.map(cellsT)], [['Ndërrimi', 'Arka', 'Operatori', 'Hapur', 'Mbyllur', 'Hapje', 'Pritej', 'Numëruar', 'Diferenca', 'Kupona', 'Shitje', 'Statusi'], [['SH-9', 'Arka Bar', 'Ana', '2026-09-20 08:00:00', '—', '€50.00', '—', '—', '—', '7', '€10.00', 'Në proces'], ['SH-2', 'Arka 2', 'Gent', '2026-09-05 08:00:00', '2026-09-05 20:00:00', '€0.00', '€82.50', '€82.00', '-€0.50', '55', '€82.50', 'Në rregull']]], 'Mbyllja e arkës (ledger): each shift with its receipts and sales from the server\'s totals');
      R.go('dashboard', 'Paneli'); const al = R.renderVals().alerts.find(a => a.t === 'Fiskalizimi i kuponëve POS dështoi');
      eq([al && al.s, al && al.c, R.ledgerFiscalFails().n], ['2 kupona · BAR-2/0001 · ATK: timeout', '#DC2626', 2], 'dashboard: the fiscal failures of the POS ledger rows (count + the latest failed receipt with its error)');
      al.go(); eq([R.state.section, R.state.page, R.state.fiscalTab], ['settings', 'Fiskalizimi', 'Kuponët'], 'dashboard alert → the fiscal monitor\'s "Kuponët" tab');
      eq(rcOf('t9', k0).filter(x => !/fiscal=open/.test(x)), [], 'the derived pages asked the server for no receipt'); await settle(R); }
    // ── the fiscal monitor's "Kuponët" tab: GET /pos/receipts?fiscal=open (365 days), paged; a refusal is shown, not a spinner
    { R.setState({ posList: null }); const k0 = S.calls.length; R.setState({ section: 'settings', page: 'Fiskalizimi', fiscalTab: 'Kuponët' }); await settle(R); let v = R.renderVals();
      eq([rcOf('t9', k0), v.fiscalReceiptsCount, v.fiscalReceiptsNote, v.fiscalHasReceipts, v.fiscalHasMore, v.fiscalReceipts.map(x => [x.no, x.when, x.posName, x.cfg, x.totalFmt, x.fiscal, x.ref])], [['GET /pos/receipts?fiscal=open&from=2025-09-21&to=2026-09-20&limit=50&offset=0'], '3', 'kuponë pa u fiskalizuar (365 ditët e fundit, nga serveri) · vetëm lexim', true, false,
        [['BAR-2/0001', '20.09.2026 18:00', 'Arka 2 · Qendra', 'ATK_ELECTRONIC · v3', '€1.50', 'Dështoi', 'ATK: timeout'], ['BAR-1/0015', '20.09.2026 13:00', 'Arka Bar · Qendra', 'ATK_ELECTRONIC · v3', '€1.50', 'Në pritje', '—'], ['BAR-1/0012', '20.09.2026 11:00', 'Arka Bar · Qendra', 'ATK_ELECTRONIC · v3', '€6.00', 'Në pritje', '—']]], 'fiscal monitor "Kuponët" (ledger): GET /pos/receipts?fiscal=open over 365 days — the receipts not fiscalized, one by one');
      const k1 = S.calls.length; v.fiscalReceipts[0].open(); await settle(R); eq([R.state.dr, rcOf('t9', k1)], [{ kind: 'posApi', id: 's6' }, ['GET /pos/receipts/s6']], 'fiscal monitor: a receipt opens from the server'); R.setState({ dr: null });
      R.POS_LIST_PAGE = 2; R.setState({ posList: null }); await settle(R); v = R.renderVals();
      eq([v.fiscalReceipts.length, v.fiscalReceiptsCount, v.fiscalHasMore, v.fiscalMoreLabel], [2, '3', true, 'Shfaq më shumë (1 nga 1 të tjerë)'], 'fiscal monitor: paged ("Shfaq më shumë")');
      const k2 = S.calls.length; v.fiscalMore(); await settle(R); v = R.renderVals(); R.POS_LIST_PAGE = 50;
      eq([rcOf('t9', k2), v.fiscalReceipts.map(x => x.no), v.fiscalHasMore], [['GET /pos/receipts?fiscal=open&from=2025-09-21&to=2026-09-20&limit=2&offset=2'], ['BAR-2/0001', 'BAR-1/0015', 'BAR-1/0012'], false], 'fiscal monitor: the next page appended (offset)');
      R.setState({ fiscalTab: 'Arkat' }); await settle(R); T9.rcDeny = true; const k3 = S.calls.length; R.setState({ fiscalTab: 'Kuponët' }); await settle(R); v = R.renderVals(); T9.rcDeny = false;
      eq([rcOf('t9', k3).length, v.fiscalHasReceipts, v.fiscalReceipts.length, v.fiscalReceiptsNote.endsWith(' · Nuk keni leje për kuponët e POS-it — kërkojini pronarit qasjen.'), v.fiscalHasMore], [1, true, 3, true, false], 'fiscal monitor: back on the tab the list is read again; a refusal keeps the rows shown and says so');
      T9.rcDeny = true; R.setState({ posList: null }); await settle(R); v = R.renderVals(); T9.rcDeny = false;
      eq([v.fiscalHasReceipts, v.fiscalReceiptsEmpty, R.state.posList.busy], [false, 'Nuk keni leje për kuponët e POS-it — kërkojini pronarit qasjen.', false], 'fiscal monitor: a refusal is shown in place of the list');
      R.go('dashboard', 'Paneli'); await settle(R); }
    // ── the A4 invoice from a server receipt (ledger mode): created once in the book, refused inside the commit, never a write to the receipt
    const writesRc = () => S.calls.filter(x => x.tid === 't9' && x.m !== 'GET' && /^\/pos\/receipts/.test(x.p) && x.p !== '/pos/receipts/known').map(x => x.m + ' ' + x.p);
    { R.openPosReceipt('s2', I.s2); await settle(R); const n0 = T9.commits.length, mv0 = R.state.db.movements.length, pay0 = R.state.db.payments.length, kafe0 = R.stockOf('KAFE'), cash0 = R.accountBalance('cash2');
      R.drawerVals().actions.find(a => a.label === 'Gjenero faturë A4 nga kuponi').go(); eq(R.state.confirm.title, 'Faturë A4 për kuponin BAR-1/0012?', 'A4: the drawer asks first');
      R.state.confirm.ok(); await until(() => R.state.page === 'Fatura' && !(R._pending || []).length && !R._flushing); await settle(R);
      const last = T9.commits[T9.commits.length - 1] || {}, inv = (last.invoices || [])[0] || {};
      eq([T9.commits.length - n0, Object.keys(last), inv.kind, inv.no, inv.fromPos, inv.posNo, inv.customer, inv.nui, inv.date, inv.status, inv.sub, inv.vat, inv.total, inv.paid, inv.fiscal, inv.fiscalRef, inv.items.map(i => [i.sku, i.qty, i.tot]), inv.note],
        [1, ['invoices'], 'Faturë', 'FSH-2026-00001', 's2', 'BAR-1/0012', 'Drini Market SH.P.K.', '811234500', '20.09.2026', 'Paguar', 508, 92, 600, 600, 'Në pritje', '—', [['KAFE', 2, 300], ['UJE', 3, 300]], 'Faturë A4 për kuponin BAR-1/0012 · Arka Bar · Besa'],
        'A4 (ledger): ONE commit with only the invoice — fromPos = the receipt id, the receipt\'s lines, totals and fiscal state');
      eq([writesRc(), R.state.db.movements.length - mv0, R.state.db.payments.length - pay0, R.stockOf('KAFE'), R.accountBalance('cash2'), R.salesDocs().filter(r => r.src === 'inv').length, '_srv' in inv, JSON.stringify(last).includes('"_srv"')], [[], 0, 0, kafe0, cash0, 0, false, false], 'A4 (ledger): no write to the server receipt (no PATCH), no second sale / stock / money, nothing `_srv` committed');
      eq([R.state.section, R.state.page, R.state.drawer, R.state.dr, R.state.toast], ['shitje', 'Fatura', 'FSH-2026-00001', null, 'Fatura FSH-2026-00001 u gjenerua nga kuponi BAR-1/0012'], 'A4: the new invoice opens');
      const n1 = T9.tries; eq([await R.invoiceFromReceipt('s2', I.s2), R.state.toast, T9.tries - n1, R.state.db.invoices.filter(i => i.fromPos === 's2').length], [null, 'Kuponi ka tashmë faturën A4 FSH-2026-00001 — nuk krijohet e dyta', 0, 1], 'A4: a second one for the same receipt is refused');
      eq([await R.invoiceFromReceipt('R:s2'), T9.tries - n1], [null, 0], 'A4: also when asked for the ledger row id (R:…)');
      // another tab's A4 for the same receipt reaches this page while the receipt is still being read → refused INSIDE the commit
      const h = defer(); S.rcHold = (tid, path) => (path === '/pos/receipts/s5' ? h.p : null); const pr = R.invoiceFromReceipt('s5'); await wait(10);
      R.setState(s => ({ db: { ...s.db, invoices: [{ kind: 'Faturë', no: 'FSH-2026-00077', fromPos: 's5', posNo: 'BAR-1/0016', customer: 'Klient me shumicë', nui: '—', date: '20.09.2026', due: '20.09.2026', status: 'Paguar', items: [], sub: 100, vat: 0, total: 100, paid: 100 }, ...s.db.invoices] } }));
      const n2 = T9.tries; S.rcHold = null; h.open(); const res = await pr; await wait(20);
      eq([res, R.state.toast, T9.tries - n2, R.state.db.invoices.filter(i => i.fromPos === 's5').map(i => i.no)], [null, 'Kuponi BAR-1/0016 ka tashmë faturën A4 FSH-2026-00077 — nuk krijohet e dyta', 0, ['FSH-2026-00077']], 'A4: the refusal is decided inside the commit (an A4 that arrived meanwhile) — no second invoice, nothing sent');
      R.setState(s => ({ db: { ...s.db, invoices: s.db.invoices.filter(i => i.no !== 'FSH-2026-00077') } }));
      eq([await R.invoiceFromReceipt('r1', I.r1), R.state.toast], [null, 'Fatura A4 krijohet vetëm nga një kupon i finalizuar (ky është “Kthim”)'], 'A4: only from a Finalizuar receipt (a return is refused)');
      eq([await R.invoiceFromReceipt('s1'), R.state.toast], [null, 'Fatura A4 krijohet vetëm nga një kupon i finalizuar (ky është “Kthyer”)'], 'A4 by id: the receipt is read from the server first (a returned sale is refused)');
      eq([await R.invoiceFromReceipt('nope'), R.state.toast, T9.tries - n2], [null, 'Kuponi nuk u lexua nga serveri: Kuponi nuk u gjet', 0], 'A4: a receipt the server does not have → nothing made');
      const n3 = T9.tries, [a1, a2] = await Promise.all([R.invoiceFromReceipt('s7'), R.invoiceFromReceipt('s7')]); await until(() => !(R._pending || []).length && !R._flushing);
      eq([[a1, a2].filter(Boolean), R.state.db.invoices.filter(i => i.fromPos === 's7').map(i => i.no), T9.state.invoices.filter(i => i.fromPos === 's7').length, T9.tries - n3], [['FSH-2026-00002'], ['FSH-2026-00002'], 1, 1], 'A4: two clicks at once (the receipt read from the server meanwhile) → one invoice, one commit');
      // the A4 shows on P:Shitje and in the receipt drawer; the invoice's receipt link opens the receipt through the API
      R.go('pos', 'Shitje'); R.posFilter({ range: '31', from: '', to: '', terminal: '' }); await settle(R);
      eq(R.pageTable('P:Shitje').rows.find(r => r.cells[0].t === 'BAR-1/0012').cells[11].t, 'FSH-2026-00001', 'P:Shitje: the "Fatura A4" column (db.invoices fromPos)');
      R.openPosReceipt('s2'); await settle(R); const D = R.drawerVals(); eq([lab(D.actions), D.history.some(x => x.a === 'Fatura A4 FSH-2026-00001 e lidhur me këtë kupon')], [['Hap faturën FSH-2026-00001', 'Statuset fiskale'], true], 'receipt drawer: "Hap faturën" instead of a second A4');
      D.actions[0].go(); eq([R.state.page, R.state.drawer, R.state.dr], ['Fatura', 'FSH-2026-00001', null], '"Hap faturën" opens the invoice');
      const k0 = S.calls.length; R.renderVals().openInvSrc(); await settle(R); eq([R.state.dr, rcOf('t9', k0)], [{ kind: 'posApi', id: 's2' }, ['GET /pos/receipts/s2']], 'invoice drawer: "Kuponi BAR-1/0012" opens the receipt through the API (not in the book)');
      R.setState({ dr: null, drawer: null }); R.go('dashboard', 'Paneli'); await settle(R); }
    // ── Cilësime › API with the POS ledger: the server's read-only keys (GET / POST / DELETE /api-keys); the raw key shown once
    const keysOf = (tid, k0) => S.calls.slice(k0).filter(x => x.tid === tid && /^\/api-keys/.test(x.p)).map(x => x.m + ' ' + x.p);
    { const h = defer(); S.rcHold = null; const k0 = S.calls.length; const hk = (S.akHold = h);
      R.go('settings', 'API'); await wait(); let P = R.settingsPage('API');
      eq([P.cards[0].title, P.cards[0].note], ['Çelësat API', 'Duke ngarkuar çelësat nga serveri…'], 'Cilësime › API (ledger): loading the keys from the server');
      hk.open(); S.akHold = null; await settle(R); P = R.settingsPage('API');
      eq([keysOf('t9', k0), P.cards.map(c => c.title), P.cards[0].table.rows, P.cards[0].note, lab(P.cards[0].actions), P.cards.find(c => c.title === 'Dokumentimi').rows[0].v], [['GET /api-keys'], ['Çelësat API', 'Dokumentimi'], [], 'Asnjë çelës ende — krijoni një me “+ Çelës i ri”.', ['+ Çelës i ri', 'Rifresko'], 'http://127.0.0.1:8801/api/v1'], 'Cilësime › API: GET /api-keys once, empty list');
      R.setState({ x: 5 }); await settle(R); eq(keysOf('t9', k0).length, 1, 'Cilësime › API: not asked again on every update');
      P.cards[0].actions[0].go(); let F = R.formVals();
      eq([R.state.frm.kind, F.title, F.fields.map(f => f.key), F.actions.map(a => [a.label, a.disabled]), F.fields[1].opts.map(o => o.on), F.fields[1].hint], ['apiKeySrv', 'Çelës API i ri', ['name', 'scopes'], [['Krijo çelësin', true]], ['1', ''], 'pos:read'], 'new key form: a name and the read-only scopes (pos:read preselected); no name → disabled');
      R.setF({ name: '  Power BI ' }); F = R.formVals(); eq(F.actions[0].disabled, false, 'new key form: name + a scope → enabled');
      F.fields[1].opts[0].go(); F = R.formVals(); eq([F.actions[0].disabled, F.fields[1].hint], [true, 'zgjidhni të paktën një'], 'new key form: no scope → disabled');
      F.fields[1].opts[1].go(); R.formVals().fields[1].opts[0].go(); F = R.formVals(); eq([F.actions[0].disabled, F.fields[1].hint, F.fields[1].opts.map(o => o.on)], [false, 'pos:read, state:read', ['1', '1']], 'new key form: the scopes toggle like checkboxes');
      R.setF({ name: 'x'.repeat(81) }); F = R.formVals(); eq([F.actions[0].disabled, F.fields[0].err, F.fields[0].hint], [true, '1', 'deri në 80 karaktere'], 'new key form: a name over 80 characters is refused');
      R.setF({ name: '  Power BI ' }); const k1 = S.calls.length; R.formVals().actions[0].go(); eq([R.formVals().actions[0].label, R.formVals().actions[0].disabled], ['Po krijohet…', true], 'new key form: busy while the server creates it');
      await until(() => !!R.state.apiSecret); const raw = (T9.rawKeys || [])[0] || '?', post = S.calls.slice(k1).find(x => x.m === 'POST' && x.p === '/api-keys');
      P = R.settingsPage('API');
      eq([post && post.body, R.state.frm, R.state.apiSecret, P.cards.map(c => c.title), P.cards[1].rows[0].v, P.cards[1].rows[0].k, lab(P.cards[1].actions), P.cards[0].table.rows.map(cellsT)], [{ name: 'Power BI', scopes: ['pos:read', 'state:read'] }, null, { name: 'Power BI', key: raw, scopes: 'pos:read, state:read' }, ['Çelësat API', 'Çelësi i ri — kopjojeni TANI', 'Dokumentimi'], raw, 'Power BI · pos:read, state:read', ['Kopjo çelësin', 'E ruajta, fshihe'],
        [['Power BI', raw.slice(0, 12) + '…', 'pos:read · state:read', R.isoStamp('2026-09-20T10:00:00Z'), '—', 'Aktiv', 'Revoko']]], 'POST /api-keys {name (trimmed), scopes} → the raw key shown once (copy + hide), the key in the list with its prefix only');
      P.cards[1].actions[0].go(); eq(/Kopjimi automatik nuk lejohet/.test(R.state.toast || ''), true, '"Kopjo çelësin" without a clipboard says so (no crash)');
      P.cards[1].actions[1].go(); P = R.settingsPage('API');
      eq([R.state.apiSecret, P.cards.map(c => c.title), JSON.stringify(R.state).includes(raw), JSON.stringify(mem).includes(raw), JSON.stringify(T9.state).includes(raw) || JSON.stringify(T9.commits).includes(raw)], [null, ['Çelësat API', 'Dokumentimi'], false, false, false], '"E ruajta, fshihe": the raw key is gone from the page and was never stored (state, localStorage, book)');
      const k2 = S.calls.length; P.cards[0].actions[1].go(); await settle(R); P = R.settingsPage('API');
      eq([keysOf('t9', k2), P.cards[0].table.rows.length, JSON.stringify(R.state.apiKeysSrv).includes(raw)], [['GET /api-keys'], 1, false], '"Rifresko": GET /api-keys again — the server never returns the raw key');
      P.cards[0].table.rows[0].cells[6].go(); eq(R.state.confirm.title, 'Revoko çelësin “Power BI”?', 'revoke asks first'); R.state.confirm.ok(); await until(() => R.state.apiKeysSrv.items[0].revokedAt); P = R.settingsPage('API');
      eq([keysOf('t9', k2).slice(-1), P.cards[0].table.rows.map(r => [r.cells[5].t, r.cells[5].sub, r.cells[6].t, r.cells[0].color]), R.settingsPage('Integrimet').cards.find(c => c.title === 'API').rows[0]], [['DELETE /api-keys/key-1'], [['Revokuar', R.isoStamp('2026-09-20T11:00:00Z'), '', '#8FA3B8']], { k: 'Çelësa aktivë (në server)', v: '0', font: 'inherit', color: '#10243A' }], 'DELETE /api-keys/{id}: the key stays in the list, revoked (greyed, no action); Integrimet counts the active ones');
      eq([await R.apiKeyCreate('Y', ['pos:write']), R.state.toast, T9.keys.length], [null, 'Çelësi nuk u krijua: Të dhënat e kërkesës janë të pavlefshme', 1], 'POST /api-keys refused (unknown scope) → a toast, nothing listed');
      const k3 = S.calls.length; R.apiCommit({ apiKeys: [{ id: 'x' }] }); await wait(10); eq([S.calls.slice(k3).filter(x => x.p === '/state/commit').length, 'apiKeys' in T9.state], [0, false], 'apiKeys is server data (SERVER_KEYS): never committed to the book');
      R.go('dashboard', 'Paneli'); await settle(R); }
    // a member without "Kompania": the refusal is shown (no spinner, no retry), creating a key is refused with a toast and the form stays open
    { const K = mkR(); await enter(K, 'kas', 't9'); const k0 = S.calls.length; K.go('settings', 'API'); await settle(K); K.setState({ x: 1 }); await settle(K); let P = K.settingsPage('API');
      eq([keysOf('t9', k0), P.cards[0].note, P.cards[0].noteColor, P.cards[0].table.rows], [['GET /api-keys'], 'Nuk keni leje për çelësat API (leja “Kompania”).', '#B91C1C', []], 'Cilësime › API without the "Kompania" permission: 403 shown, asked once');
      K.openForm('apiKeySrv', { name: 'X', sPos: true, sState: false }); K.formVals().actions[0].go(); await until(() => K.state.frm && !K.state.frm.busy && /Çelësi nuk u krijua/.test(K.state.toast || ''));
      eq([K.state.frm && K.state.frm.kind, K.state.frm && K.state.frm.busy, K.state.toast, K.state.apiSecret], ['apiKeySrv', false, 'Çelësi nuk u krijua: Nuk keni leje', null], 'POST /api-keys refused (403): the form stays open, no longer busy');
      K.logout(); done(K); }
    // ── P:Arkat "Rigjenero tokenin": POST /terminals/{id}/rotate → the new token shown once, never stored
    { R.go('pos', 'Arkat'); await settle(R); const T = R.pageTable('P:Arkat'), n0 = T9.tries;
      T.rows[0].cells[11].go(); eq(R.state.confirm.title, 'Rigjenero token-in e “Arka Bar”?', 'rotate asks first'); R.state.confirm.ok(); await until(() => R.state.confirm && /^Token-i i ri/.test(R.state.confirm.title));
      eq([calls('t9', /^POST \/terminals\/.+\/rotate$/).map(x => x.p), R.state.confirm.title, R.state.confirm.body.endsWith(' kt_new1'), R.state.confirm.body.includes('http://127.0.0.1:8801/api/v1'), /duhet rilidhur/.test(R.state.toast || '')], [['/terminals/' + TERM.id + '/rotate'], 'Token-i i ri i terminalit “Arka Bar” (shfaqet vetëm një herë)', true, true, true], 'POST /terminals/{id}/rotate → the new token shown once with the server address');
      R.setState({ confirm: null }); eq([JSON.stringify(R.state).includes('kt_new1'), JSON.stringify(mem).includes('kt_new1'), T9.tries - n0], [false, false, 0], 'rotate: the token is shown only in that dialog — never stored, nothing committed');
      eq([await R.terminalRotate({ id: TERM2.id, name: 'Arka 2' }), await R.terminalRotate({ id: 'nope', name: 'X' }), R.state.toast], ['kt_new2', null, 'Rigjenerimi i token-it dështoi: Terminali nuk u gjet'], 'rotate: a new token each time; an unknown terminal → a toast');
      R.setState({ confirm: null }); R.go('dashboard', 'Paneli'); await settle(R); }
    // ── ensurePins: the default PIN's salt is derived from the user → the catalogue (and its hash) is the same on every call / tick
    { const c0 = new C({}), u0 = { id: 'u9', name: 'Test', email: 't@x', role: 'Kasier', status: 'Aktiv' }, e1 = c0.ensurePins([u0])[0], e2 = c0.ensurePins([{ ...u0 }])[0], set = { ...u0, id: 'u8', pinSalt: 'ffff0000', pinHash: 'h' };
      eq([e1.pinSalt, e1.pinHash === e2.pinHash, e1.pinHash === c0.pinHash('0000', e1.pinSalt), c0.pinIsDefault(e1), c0.ensurePins([{ ...u0, id: 'u10' }])[0].pinSalt !== e1.pinSalt, c0.ensurePins([set])[0] === set],
        [c0.sha256('kontabo.pin:u9').slice(0, 8), true, true, true, true, true], 'ensurePins: the default PIN (0000) with a salt derived from the user — the same on every call, different per user; a set PIN is untouched');
      const L = new C({}); L._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' }; L.state.db = L.seedDb(); L.state.db = { ...L.state.db, users: L.state.db.users.map(({ pinHash, pinSalt, ...u }) => u) }; L.state.session = { name: 'Arben Berisha', role: 'Pronar', userId: 'u1' };
      const h1 = L.posCatalogHash(), h2 = L.posCatalogHash(), ops = L.posCatalogPayload().operators; const cl = [];
      L.posFetch = async (path, o = {}) => { cl.push((o.method || 'GET') + ' ' + path.split('?')[0]); if (path === '/health') return { pos_name: 'Arka', pos_id: 'POS-0001', version: '1', pending_sync: 0, fiscal: { pending: 0, mode: 'ATK_ELECTRONIC' } }; if (path.startsWith('/sales')) return { receipts: [], shifts: [], cursor: 0 }; return {}; };
      await L.posSync(false); await L.posSync(false); await L.posSync(false);
      eq([h1 === h2, ops.length > 0, ops.every(o => o.pinSalt && o.pinHash === L.pinHash('0000', o.pinSalt)), cl.filter(x => x === 'POST /catalog').length], [true, true, true, 1], 'users without a PIN: the catalogue hash is stable → pushed once, not on every tick'); clearTimeout(L._t); }
    // ── render sweep (ledger mode): every page, the POS lists / fiscal tab in every state, every receipt and summary drawer state, the key page
    { const errs = [], tryR = (what, f) => { try { f(); R.renderVals(); R.drawerVals(); R.formVals(); } catch (e) { errs.push(what + ': ' + e.message); } };
      const items = Object.values(I).concat([old, { ...I.c3, frozen: null, ledgerState: 'wait_orig' }, { id: 'bare' }]), w = { Shitje: 'list|Shitje|2026-08-21|2026-09-20||final,returned,void|t9|q=', Kthime: 'list|Kthime|2026-08-21|2026-09-20||return,cancel|t9|q=', fiscal: 'fiscal|2025-09-21|2026-09-20|t9' };
      const lists = [{ busy: true, err: '', items: [], total: 0 }, { busy: false, err: '', items, total: 70 }, { busy: true, err: '', items, total: 70 }, { busy: false, err: 'Nuk keni leje', items: [], total: 0 }, { busy: false, err: 'Gabim', items, total: 70 }, { busy: false, err: '', items: [], total: 0 }];
      for (const n of R.NAV) for (const pg of n.items) tryR(n.id + '/' + pg, () => Object.assign(R.state, { admin: false, section: n.id, page: pg, dr: null, frm: null }));
      for (const [pg, base] of Object.entries(w)) for (const [i, L] of lists.entries()) tryR(pg + ' list state ' + i, () => Object.assign(R.state, { section: pg === 'fiscal' ? 'settings' : 'pos', page: pg === 'fiscal' ? 'Fiskalizimi' : pg, fiscalTab: 'Kuponët', posList: { key: base + '|p1', base, pages: 1, ...L } }));
      for (const it of items) for (const st of [{ busy: true, item: null }, { busy: true, item: it }, { busy: false, item: it, related: items.slice(0, 4) }, { busy: false, err: 'Kuponi nuk u gjet në server', item: null }]) tryR('receipt drawer ' + it.id, () => Object.assign(R.state, { dr: { kind: 'posApi', id: it.id }, posRc: { id: it.id, related: [], err: '', ...st } }));
      for (const r of R.view().posReceipts) tryR('POS document ' + r.id, () => Object.assign(R.state, { dr: { kind: 'pos', id: r.id } }));
      tryR('API keys page', () => Object.assign(R.state, { dr: null, section: 'settings', page: 'API', apiKeysSrv: { busy: false, err: '', items: [{ id: 'k1', name: 'A', prefix: 'kk_x', scopes: ['pos:read'], createdBy: 'X', createdAt: '2026-09-20T10:00:00Z', lastUsedAt: '2026-09-20T10:05:00Z', revokedAt: null }, { id: 'k2', name: 'B', prefix: 'kk_y', scopes: [], createdAt: null, revokedAt: '2026-09-20T11:00:00Z' }] }, apiSecret: { name: 'A', key: 'kk_secret', scopes: 'pos:read' } }));
      tryR('API keys page (error)', () => Object.assign(R.state, { apiKeysSrv: { busy: false, err: 'Nuk keni leje', items: [] }, apiSecret: null }));
      tryR('API key form', () => Object.assign(R.state, { frm: { kind: 'apiKeySrv', name: 'x'.repeat(90), sPos: false, sState: true, busy: true } }));
      Object.assign(R.state, { frm: null, dr: null, posRc: null, posList: null, apiKeysSrv: null, section: 'dashboard', page: 'Paneli' });
      eq(errs, [], 'ledger mode (E-L2): every page, the receipt lists in every state, every receipt / summary drawer state and the API key page render without throwing'); }
    eq([S.bad, S.noHdr, writesRc()], [[], [], []], 'mock server (E-L2): no commit carried `_srv` or posSync runtime fields, every call had X-Kontabo-Client: 2, nothing ever wrote to a server receipt');
    // leaving the page while the search waits for the typing to stop: nothing is asked; switching the company drops what is still on its way
    { R.go('pos', 'Shitje'); await settle(R); const k0 = S.calls.length; R.pageTable('P:Shitje').setQ({ target: { value: 'Ana' } }); await wait(20); R.go('dashboard', 'Paneli'); await wait(350); await settle(R);
      eq([rcOf('t9', k0), R._plT], [[], null], 'search typed, then another page before 300 ms: the pending search is dropped');
      R.posFilter({ q: '' }); R.go('pos', 'Shitje'); await settle(R); const hL = defer(), hR = defer(); S.rcHold = (tid, path) => (tid === 't9' ? (path.startsWith('/pos/receipts?') ? hL.p : hR.p) : null);
      R.posListSync(true); R.openPosReceipt('s2'); await wait(); await R.apiSwitchTenant('t1'); await until(() => R._ledger && R._ledger.tenantId === 't1' && R._ledger.loaded);
      hL.open(); hR.open(); S.rcHold = null; await wait(20);
      eq([R.apiCfg().tenantId, R.state.posList, R.state.posRc, R.state.dr, R.state.page], ['t1', null, null, null, 'Paneli'], 'company switch: a receipt list and a receipt of the old company still on their way are dropped'); }
    R.logout(); done(R); clearTimeout(R._plT);
    // ── the ledger feature off (an older server): the book's own pages and drawers as before — no /pos/receipts, /api-keys or token rotation
    S.features = []; const T10 = mkT('t10', 'Relay SH.P.K.', legacyBook()); T10.terms = [{ id: 'k1', name: 'Arka Bar', branch: 'Qendra', posId: 'BAR-1', warehouse: 'W2', status: 'Aktiv', lastSeen: '' }];
    { const X = mkR(); await enter(X, 'own', 't10'); const k0 = S.calls.length, srvCalls = () => S.calls.slice(k0).filter(x => /^\/pos\/receipts|^\/api-keys|\/rotate$/.test(x.p)).map(x => x.m + ' ' + x.p);
      X.go('pos', 'Shitje'); await settle(X); const T = X.pageTable('P:Shitje');
      eq([X._ledger, X.posListWant(), X.apiKeysOn(), X.state.posList, T.sub.startsWith('Kuponët e sinkronizuar nga POS-i desktop'), T.hasFilters, T.count, T.rows.map(r => r.cells[0].t), T.actions.map(a => a.label)], [null, null, false, null, true, false, '3', ['BAR-1/0004', 'BAR-1/0002', 'BAR-1/0001'], ['Sinkronizo tani', 'Eksporto CSV']], 'feature off: P:Shitje is the book\'s list (no server list, no filters)');
      X.go('pos', 'Kthime'); await settle(X); eq(X.pageTable('P:Kthime').rows.map(r => r.cells[0].t), ['BAR-1/0003'], 'feature off: P:Kthime from the book');
      X.go('pos', 'Arkat'); await settle(X); const A = X.pageTable('P:Arkat'); eq([A.cols.length, A.rows.map(r => r.cells.length), A.kpis[1].label], [11, [11], 'Sinkronizimi nga serveri'], 'feature off: P:Arkat without "Rigjenero tokenin"');
      eq([X.pageTable('P:Operatorët').cols.length, X.pageTable('P:Mbyllja e arkës').cols.length, X.pageTable('P:Operatorët').hasPeriod], [10, 10, false], 'feature off: P:Operatorët and Mbyllja e arkës as before');
      X.go('settings', 'API'); await settle(X); const P = X.settingsPage('API');
      eq([P.cards.map(c => c.title), P.cards[0].table.cols.map(c => c.label), lab(P.cards[0].actions)], [['Çelësat API', 'Dokumentimi'], ['Emri', 'Çelësi', 'Krijuar', 'Përdorur së fundi', 'Të drejtat', 'Statusi', ''], ['+ Çelës i ri']], 'feature off: Cilësime › API is the book\'s page (as before)');
      X.setState({ section: 'settings', page: 'Fiskalizimi', fiscalTab: 'Kuponët' }); await settle(X); const v = X.renderVals();
      eq([v.fiscalReceiptsCount, v.fiscalReceiptsNote, v.fiscalReceipts.map(x => x.no), v.fiscalHasMore], ['4', 'kuponë të sinkronizuar · vetëm lexim', ['BAR-1/0004', 'BAR-1/0003', 'BAR-1/0002', 'BAR-1/0001'], false], 'feature off: the fiscal "Kuponët" tab lists the book\'s receipts');
      X.openDr('pos', 'rA'); let D = X.drawerVals(); eq([X.state.dr, D.no, lab(D.actions)[0]], [{ kind: 'pos', id: 'rA' }, 'BAR-1/0001', 'Gjenero faturë A4 nga kuponi'], 'feature off: a receipt opens the book\'s drawer');
      D.actions[0].go(); X.state.confirm.ok(); await until(() => !(X._pending || []).length && !X._flushing); await wait(10);
      const last = T10.commits[T10.commits.length - 1] || {};
      eq([Object.keys(last).sort(), (last.invoices || [])[0] && last.invoices[0].fromPos, (last.posReceipts || []).find(r => r.id === 'rA').invoiceNo, X.state.drawer], [['invoices', 'posReceipts'], 'rA', 'FSH-2026-00001', 'FSH-2026-00001'], 'feature off: the A4 invoice as before (the receipt in the book gets invoiceNo)');
      X.go('dashboard', 'Paneli'); eq([X.renderVals().alerts.some(a => /kuponëve POS/.test(a.t)), srvCalls()], [false, []], 'feature off: no POS-ledger alert; never /pos/receipts, /api-keys or a rotation');
      X.logout(); done(X); clearTimeout(X._plT); }
    S.features = ['posLedger:1'];
    // ── local mode (no server): as before — no server list, the book's API keys, the A4 invoice of a booked receipt
    { const Lc = new C({}), set = Lc.setState.bind(Lc); let q = false; Lc.setState = u => { set(u); if (!q) { q = true; Promise.resolve().then(() => { q = false; Lc.componentDidUpdate(); }); } };
      Lc._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' }; Lc.state.db = Lc.seedDb(); Lc.state.session = { name: 'Arben Berisha', role: 'Pronar', userId: 'u1' };
      const k0 = S.calls.length; Lc.go('pos', 'Shitje'); await wait(10); Lc.go('settings', 'API'); await wait(10); Lc.setState({ section: 'settings', page: 'Fiskalizimi', fiscalTab: 'Kuponët' }); await wait(10);
      eq([S.calls.length - k0, Lc.posListWant(), Lc.apiKeysOn(), Lc.state.posList, Lc.state.apiKeysSrv, Lc.pageTable('P:Shitje').hasFilters, Lc.pageTable('P:Arkat').cols.length], [0, null, false, null, null, false, 11], 'local mode: no server calls, the book\'s POS pages');
      const P = Lc.settingsPage('API'), n0 = (Lc.state.db.apiKeys || []).length; P.cards[0].actions[0].go(); Lc.setF({ name: 'Web', scope: 'lexo', env: 'test' }); Lc.formVals().actions[0].go();
      eq([n0, Lc.state.db.apiKeys.length, Lc.state.db.apiKeys[n0].name, /^kf_test_/.test(Lc.state.secret.key), JSON.parse(store.getItem(Lc.KEY)).apiKeys.length], [1, 2, 'Web', true, 2], 'local mode: Cilësime › API keeps its keys in the book (as before)');
      Lc.importPosSales([pay('lx', 'BAR-1/0500', 'final', [pli('LED-18', 'Ndriçues LED 18W', 'copë', 10000, 590)], { time: '10:00:00' })], []); Lc.invoiceFromReceipt('lx');
      const rr = Lc.state.db.posReceipts.find(r => r.id === 'lx'), iv = Lc.state.db.invoices.find(i => i.fromPos === 'lx');
      eq([!!iv, iv && iv.posNo, rr.invoiceNo, iv && iv.no === rr.invoiceNo, S.calls.length - k0], [true, 'BAR-1/0500', iv && iv.no, true, 0], 'local mode: the A4 invoice of a booked receipt as before'); clearTimeout(Lc._t); }
    // @@E-L2-END@@
    return { ...H, rcv, pay, pli, TERM2 }; // (+ the receipt builders, for the blocks after the review block)
  }).catch(e => { console.log('FAIL E-L2 tests threw: ' + (e && e.stack || e)); process.exitCode = 1; })
// @@REVIEW-L@@
// ══ Faza B · rishikimi (E-L, L1–L11): the review findings reproduced against the same mock server — POST /pos/receipts/known answers `states`
// for every receipt the server has (known = ok/new/dirty/unprocessed), POST /pos/ledger/activate takes `legacy` (those receipts are excluded for good) ══
  .then(async (H) => { if (!H) { console.log('FAIL review tests (E-L) skipped: the E-L2 block did not finish'); process.exitCode = 1; return; }
    const { S, users, mkT, pub, calls, jOf, mk, enter, done, wait, until, store, book, line, row, mig, day17, day20 } = H;
    const realFetch = ctx.fetch, bad0 = S.bad.length, hold = () => { let open; const p = new Promise(r => (open = r)); return { p, open }; };
    const shown = x => ({ KAFE: x.stockOf('KAFE'), UJE: x.stockOf('UJE'), cash1: x.accountBalance('cash1'), bank1: x.accountBalance('bank1') });
    const acts = T => T.activates.map(a => a.done ? 'done' : a.legacy ? 'legacy:' + a.legacy.join() : 'receipts:' + (a.receipts || []).map(r => r.id).join());
    const day10 = T => { T.led.rows.clear(); T.led.shifts.clear(); T.led.top = 0; // the 09-10 day as the server books it without rB (rA + rC only)
      pub(T, row('D:k1a2b3:2026-09-10', 'day', '2026-09-10', { n: 2, counts: { receipts: 1, returns: 1, cancels: 0, voided: 0 }, items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 30)], moves: [['KAFE', -1000, 30, 'sale']], pays: [['cash1', 'cash', 150]] })); };
    try {
      // ── L1: the server HAS rB but did not book it (error) and rL waits for its original (wait_orig) — no ledger row holds them: both stay in the
      // book as legacy and go to activate as `legacy` (excluded on the server for good); only the booked ones (rA, rC) leave the book
      { const T = mig('rv1'); T.rstate.rB = 'error'; T.rstate.rL = 'wait_orig'; day10(T);
        const M = mk(); await enter(M, 'mag', 'rv1'); const before = shown(M); M.logout(); done(M);
        const X = mk(); await enter(X, 'own', 'rv1'); await until(() => T.state.posLedgerV === 1 && !X._migrating);
        eq([before, acts(T), T.rstate.rB, T.rstate.rL], [{ KAFE: 98000, UJE: 4000, cash1: 300, bank1: 100 }, ['receipts:rC,rA', 'legacy:rL,rB', 'done'], 'excluded', 'excluded'], 'L1: `states` — the receipts the server has but did not book (error, wait_orig) are sent as `legacy` before {done:true}; the server excludes them for good');
        eq([T.state.posLegacyNos, T.state.posReceipts.map(r => r.id), T.state.movements.filter(m => m.ref === 'BAR-1/0002').length, T.state.payments.filter(p => p.ref === 'BAR-1/0002').map(p => p.account)], [['BAR-1/0004', 'BAR-1/0002'], ['rL', 'rB'], 1, ['bank1']], 'L1: rB (error) and rL (wait_orig) stay in the book as legacy, with their stock rows and payments');
        eq(shown(X), before, 'L1: no receipt lost, none counted twice — the same stock and money as the old book');
        X.logout(); done(X); }
      // ── L1: a receipt still `new` when asked, that ends in `error` after the server processed it, is asked again → it stays legacy
      { const T = mig('rv1b'); T.rstate.rB = 'new'; day10(T); T.onActivate = b => { if (b.done && T.rstate.rB === 'new') T.rstate.rB = 'error'; };
        const X = mk(); await enter(X, 'own', 'rv1b'); await until(() => T.state.posLedgerV === 1 && !X._migrating);
        eq([T.knownCalls.map(k => k.ids.join()), acts(T), T.rstate.rB, T.state.posLegacyNos, shown(X)], [['rL,rC,rB,rA', 'rB', 'rL,rC,rB,rA'], ['receipts:rC,rB,rA', 'legacy:rL', 'done', 'receipts:rC,rA', 'legacy:rL,rB', 'done'], 'excluded', ['BAR-1/0004', 'BAR-1/0002'], { KAFE: 98000, UJE: 4000, cash1: 300, bank1: 100 }], 'L1: a receipt not booked yet at the question is asked again after the processing — it ended in error → kept in the book as legacy, excluded on the server');
        X.logout(); done(X); }
      // ── L2: a receipt reaches the book between the question and the commit (an old build imports rN on the server, a 409 reloads this page's book)
      { const T = mig('rv2'); T.notReadyAfterDone = 40; let X;
        T.onActivate = body => { if (!body.done || T.injected) return; T.injected = true; const st = T.state, no = 'BAR-1/0009', dt = '11.09.2026';
          st.posReceipts = [{ id: 'rN', no, kind: 'Kupon POS', status: 'Finalizuar', date: dt, time: '10:00', pos: 'BAR-1', posName: 'Arka Bar', branch: 'Qendra', operator: 'Ana', customer: 'Klient me shumicë', nui: '—', items: [{ name: 'Kafe', sku: 'KAFE', unit: 'copë', qty: 1, unit_c: 127, rate: 18, tax: 'E', sub: 127, vatc: 23, tot: 150 }], sub: 127, vat: 23, total: 150, discount: 0, cash_c: 150, card_c: 0, change_c: 0, fiscal: 'Fiskalizuar', fiscalRef: 'TX', shift: 'SH-1' }, ...st.posReceipts];
          st.movements = [...st.movements, { date: dt, type: 'sale', sku: 'KAFE', qm: -1000, wh: 'W2', ref: no, party: 'Klient me shumicë · Arka Bar', unit_c: 30, note: 'Kupon POS' }];
          st.payments = [{ no: 'POS-10009', date: dt, dir: 'in', kind: 'pos', ref: no, party: 'Klient me shumicë · Arka Bar', amount_c: 150, account: 'cash1', method: 'Arkë', note: 'Kupon POS · para', user: 'Ana' }, ...st.payments];
          T.version++; T.known.add('rN'); pub(T, row('D:k1a2b3:2026-09-11', 'day', '2026-09-11', { n: 2, items: [line('KAFE', 'Kafe', 'copë', 20000, 300, 30)], moves: [['KAFE', -2000, 30, 'sale']], pays: [['cash1', 'cash', 300]] }));
          X.addParty('customer', { name: 'Klient gjatë kalimit', type: 'Biznes', nui: '—', fiscal: '—', city: '—', contact: '—', address: '—' }); }; // → 409 → the server book (with rN) is reloaded
        X = mk(); await enter(X, 'own', 'rv2'); await until(() => T.state.posLedgerV === 1 && !X._migrating, 3000); await wait(30);
        eq([T.knownCalls.length, (T.knownCalls[1] || { ids: [] }).ids.includes('rN'), T.state.posLegacyNos, T.state.posReceipts.map(r => r.id), T.commits.filter(p => 'posLedgerV' in p).length], [2, true, ['BAR-1/0004'], ['rL'], 1], 'L2: the commit finds rN it never asked about → abandoned, the question asked again (rN is booked → it leaves the book), one migration commit');
        eq([X.stockOf('KAFE'), X.accountBalance('cash1')], [96000, 600], 'L2: rN counted once (in the ledger), not kept as legacy next to it');
        const Q = mk(), n0 = T.commits.length; await enter(Q, 'mag', 'rv2'); await wait(30);
        eq([T.commits.length - n0, Q.stockOf('KAFE'), Q.accountBalance('cash1')], [0, 96000, 600], 'L2: the next load reconciles nothing — the same totals');
        X.logout(); Q.logout(); done(X); done(Q); }
      // ── L3: /health did not answer at the load
      const flaky = n => { let left = n; ctx.fetch = async (url, o = {}) => { if (/\/health$/.test(url) && left > 0) { left--; return { ok: false, status: 503, json: async () => ({ error: 'unavailable', message: 'Serveri po rinis' }) }; } return realFetch(url, o); }; };
      { const T = mkT('rv3', 'Hc SH.P.K.', book(), 'on'); pub(T, JSON.parse(JSON.stringify(day20))); flaky(1);
        const X = mk(); X.HEALTH_RETRY = [10, 10]; await enter(X, 'own', 'rv3'); ctx.fetch = realFetch; await X.posSync(false); await until(() => !(X._pending || []).length && !X._flushing);
        const kafe = ((T.catalogs[T.catalogs.length - 1] || { products: [] }).products.find(p => p.sku === 'KAFE') || {}).stock_qm;
        eq([!!(X._ledger && X._ledger.loaded), X.view().posReceipts.filter(r => r._srv).length, calls('rv3', /^(GET \/pos\/sales|POST \/pos\/ack|POST \/state\/commit)$/).length, T.catalogs.length, kafe], [true, 1, 0, 1, 97000], 'L3: a /health that did not answer is asked again (backoff) — the POS ledger is on: no old relay, no commit, the catalogue carries book + ledger stock');
        X.logout(); done(X); }
      { const T = mkT('rv3b', 'Hb SH.P.K.', book(), 'on'); pub(T, JSON.parse(JSON.stringify(day17))); flaky(99);
        const X = mk(); X.HEALTH_RETRY = [5, 5]; await enter(X, 'own', 'rv3b'); await X.posSync(false); ctx.fetch = realFetch;
        eq([!!(X._ledger && X._ledger.loaded), X.stockOf('KAFE'), calls('rv3b', /^(GET \/pos\/sales|POST \/pos\/ack|POST \/state\/commit)$/).length], [true, 99000, 0], 'L3: /health never answered, but the book is on the ledger (posLedgerV 1) — proof enough: the ledger is read, never the old relay');
        X.logout(); done(X); }
      { const T = mig('rv3c'); flaky(99); const X = mk(); X.HEALTH_RETRY = [5, 5]; await enter(X, 'own', 'rv3c'); await X.posSync(false); await X.posSync(true); const toast = X.state.toast || '';
        eq([X._ledger, X._ledProbe, calls('rv3c', /^(GET \/pos\/sales|POST \/pos\/ack|PUT \/pos\/catalog|GET \/pos\/status)$/).length, T.tries, T.knownCalls.length, /nuk u përgjigj/.test(toast)], [null, 'fail', 0, 0, 0, true], 'L3: /health never answered and the book is not on the ledger yet — the old relay does not run (no /pos/sales, no catalogue, no commit) while it is unknown');
        ctx.fetch = realFetch; await X.posSync(false); await until(() => T.state.posLedgerV === 1 && !X._migrating);
        eq([!!(X._ledger && X._ledger.loaded), X._ledProbe, T.state.posLegacyNos, calls('rv3c', /^GET \/pos\/sales$/).length], [true, '', ['BAR-1/0004'], 0], 'L3: the next tick asks /health again — the POS ledger is switched on and the migration runs');
        X.logout(); done(X); }
      // ── L4: the reconcile removes only the rows importPosSales writes — an adjustment / a transfer whose note starts like a POS note stays
      { const T = mkT('rv4', 'Rak SH.P.K.', book(), 'on'); const A = mk(); await enter(A, 'own', 'rv4');
        A.adjustStock({ sku: 'KAFE', counted_qm: 95000, note: 'Kthim POS i refuzuar — kafe e prishur, hedhur', date: '20.09.2026' }); await until(() => !(A._pending || []).length && !A._flushing);
        A.transferStock({ from: 'W1', to: 'W2', items: [{ name: 'Kafe', sku: 'KAFE', unit: 'copë', qty: 2 }], date: '2026-09-20', note: 'Kupon POS i vjetër — malli te bari' }); await until(() => !(A._pending || []).length && !A._flushing); A.logout(); done(A);
        const B = mk(), n0 = T.commits.length; await enter(B, 'mag', 'rv4'); await wait(30);
        eq([T.commits.length - n0, T.state.movements.map(m => [m.type, m.qm]), B.stockOf('KAFE'), B.stockOfWh('KAFE', 'W2')], [0, [['adjust', -5000], ['transfer', -2000], ['transfer', 2000]], 95000, 2000], 'L4: the next load keeps an adjustment and a transfer whose notes start with "Kthim POS" / "Kupon POS" — only sale / return / cancel rows with the exact POS note are POS rows');
        B.logout(); done(B); }
      // ── L5: "Zbraz librat", then another company before PUT /state answered
      { const TA = mkT('rv5a', 'IA SH.P.K.', book(), 'on'); pub(TA, JSON.parse(JSON.stringify(day17)));
        const TB = mkT('rv5b', 'IB SH.P.K.', book({ company: { ...book().company, name: 'IB SH.P.K.' } }), 'on'); pub(TB, JSON.parse(JSON.stringify(day20)));
        const X = mk(); await enter(X, 'own', 'rv5a'); const h = hold();
        ctx.fetch = async (url, o = {}) => { if (/\/state$/.test(url) && o.method === 'PUT' && /-rv5a$/.test((o.headers || {}).Authorization || '')) { const r = await realFetch(url, o); await h.p; return r; } return realFetch(url, o); };
        X.resetDemo(); await wait(5); await X.apiSwitchTenant('rv5b'); await until(() => X.state.db.company.name === 'IB SH.P.K.' && X._ledger && X._ledger.loaded);
        h.open(); await wait(40); ctx.fetch = realFetch;
        eq([TA.resets, TB.resets, [...TB.led.rows.values()].filter(r => !r.removed).length, X.state.db.company.name, X.state.db.products.length, X.apiCfg().version, X._ledger.rows.size, TA.state.products.length], [0, 0, 1, 'IB SH.P.K.', 5, TB.version, 1, 0], 'L5: the late answer of the first company\'s PUT /state is dropped — no ledger reset sent with the second company\'s token, its book, version and ledger untouched');
        X.logout(); done(X); }
      // ── L6: the catalogue waits for the migration (until then the page shows the old book alone — its stock misses the ledger)
      { const T = mig('rv6'); T.led.notReady = 100000; const P = mk(); P.LEDGER_POLL = 50; await enter(P, 'own', 'rv6'); await until(() => P._migrating && P._ledger && P._ledger.loaded);
        await P.posSync(false); P.state.toast = null; const man = await P.posPushCatalogSrv(true);
        eq([T.catalogs.length, man, /po kalon në server/.test(P.state.toast || ''), P.ledgerLive(P.state.db)], [0, null, true, false], 'L6: the ledger is loaded but the book is not migrated yet — no catalogue PUT (timer or "Dërgo katalogun")');
        T.led.notReady = 0; await until(() => T.state.posLedgerV === 1 && !P._migrating, 3000); await P.posSync(false);
        eq([T.catalogs.length, ((T.catalogs[0] || { products: [] }).products.find(p => p.sku === 'KAFE') || {}).stock_qm], [1, 97000], 'L6: once migrated the catalogue is PUT with book + ledger stock');
        P.logout(); done(P); }
      // ── L7: a POS sync on its way when the company changes
      { const TA = mkT('rv7a', 'HA SH.P.K.', book(), 'on'); pub(TA, JSON.parse(JSON.stringify(day17)));
        const TB = mkT('rv7b', 'HB SH.P.K.', book({ company: { ...book().company, name: 'HB SH.P.K.' } }), 'on'); pub(TB, JSON.parse(JSON.stringify(day20)));
        const X = mk(); await enter(X, 'own', 'rv7a'); const h = hold();
        ctx.fetch = async (url, o = {}) => { if (/\/pos\/status$/.test(url) && /-rv7a$/.test((o.headers || {}).Authorization || '')) await h.p; return realFetch(url, o); };
        S.gate = { tid: 'rv7b', p: new Promise(r => (S.open = r)) }; // the second company's ledger is slow
        const sync = X.posSync(false); await wait(5); await X.apiSwitchTenant('rv7b'); await until(() => X.state.db.company.name === 'HB SH.P.K.' && X._ledger && X._ledger.tenantId === 'rv7b');
        h.open(); await sync; await wait(10); ctx.fetch = realFetch;
        eq([X._ledger.loaded, TB.catalogs.length, TA.catalogs.length, JSON.parse(store.getItem('kontabo.finance.posrt.rv7b') || '{}').catalogHashSrv || ''], [false, 0, 0, ''], 'L7: the first company\'s sync that was on its way PUTs nothing (to neither company) and writes nothing into the second company\'s runtime fields');
        S.gate = null; S.open(); await until(() => X._ledger.loaded); await X.posSync(false);
        eq([TB.catalogs.length, ((TB.catalogs[0] || { products: [] }).products.find(p => p.sku === 'KAFE') || {}).stock_qm], [1, 97000], 'L7: once the second company\'s ledger loaded its catalogue goes out with book + ledger stock');
        X.logout(); done(X); }
      // ── L7 (the same window, earlier): a POS tick while the next company's book is still loading — the previous company's book is still in state
      { const TA = mkT('rv7c', 'HC SH.P.K.', book(), 'on'); pub(TA, JSON.parse(JSON.stringify(day17))); const TB = mig('rv7d');
        const X = mk(); await enter(X, 'own', 'rv7c'); const h = hold();
        ctx.fetch = async (url, o = {}) => { if (/\/state$/.test(url) && (o.method || 'GET') === 'GET' && /-rv7d$/.test((o.headers || {}).Authorization || '')) await h.p; return realFetch(url, o); };
        const sw = X.apiSwitchTenant('rv7d'); await until(() => X.apiCfg().tenantId === 'rv7d'); await wait(5); await X.posSync(false); await X.posSync(true);
        const during = [X._ledger, calls('rv7d', /^(GET \/pos\/status|GET \/pos\/sales|GET \/pos\/ledger|PUT \/pos\/catalog|POST \/state\/commit)$/).length, TB.tries];
        h.open(); await sw; ctx.fetch = realFetch; await until(() => TB.state.posLedgerV === 1 && !X._migrating);
        eq([during, X._ledger && X._ledger.tenantId, TB.state.posLegacyNos], [[null, 0, 0], 'rv7d', ['BAR-1/0004']], 'L7: a POS tick while the next company\'s book is still loading runs nothing on the previous book (no relay, no ledger, no commit); then the company loads and migrates as usual');
        X.logout(); done(X); }
      // ── L8: an older backend (no posLedger:1): Cilësime › API keeps its keys in the book, as before
      { S.features = []; try { const T = mkT('rv8', 'Old SH.P.K.', (() => { const { posLedgerV, ...b } = book(); return { ...b, apiKeys: [] }; })(), 'off');
          const X = mk(); await enter(X, 'own', 'rv8'); X.go('settings', 'API'); const n0 = T.commits.length; X.settingsPage('API').cards[0].actions[0].go(); X.setF({ name: 'Web', scope: 'lexo', env: 'test' }); X.formVals().actions[0].go();
          await until(() => !(X._pending || []).length && !X._flushing); await wait(10);
          eq([X.apiKeysOn(), T.commits.slice(n0).some(p => 'apiKeys' in p), (T.state.apiKeys || []).map(k => k.name)], [false, true, ['Web']], 'L8: without the POS-ledger backend a new API key is committed to the book (apiKeys is server data only where /api-keys exists)');
          X.logout(); done(X); const Y = mk(); await enter(Y, 'own', 'rv8'); eq((Y.state.db.apiKeys || []).map(k => k.name), ['Web'], 'L8: … and is still there after a reload'); Y.logout(); done(Y); }
        finally { S.features = ['posLedger:1']; } }
      // ── L9: an unsent A4 invoice of a LEGACY receipt survives the next load (its patch carries that legacy receipt, marked with the invoice)
      { const st = book({ posLegacyNos: ['L-1'], posReceipts: [{ id: 'l1', no: 'L-1', kind: 'Kupon POS', status: 'Finalizuar', date: '01.08.2026', total: 118, sub: 100, vat: 18, discount: 0, customer: 'Drini Market SH.P.K.', nui: '811234500', posName: 'Arka Bar', operator: 'Ana', fiscal: 'Fiskalizuar', fiscalRef: 'TX', items: [{ name: 'Kafe', sku: 'KAFE', unit: 'copë', qty: 1, unit_c: 100, rate: 18, tax: 'E', sub: 100, vatc: 18, tot: 118 }] }] });
        const T = mkT('rv9', 'Leg SH.P.K.', st, 'on'); const A = mk(); await enter(A, 'own', 'rv9');
        ctx.fetch = async (url, o = {}) => { if (/\/state\/commit$/.test(url)) throw new TypeError('Failed to fetch'); return realFetch(url, o); };
        A.invoiceFromReceipt('l1'); await wait(30); const pend = JSON.parse(store.getItem('kontabo.finance.pending') || '[]'); clearTimeout(A._retryT); ctx.fetch = realFetch;
        const B = mk(); await B.apiEnter(jOf('own', 'rv9'), true, false); await until(() => B._ledger && B._ledger.loaded && !(B._pending || []).length && !B._flushing); await wait(30);
        const inv = (T.state.invoices || []).filter(i => i.fromPos === 'l1');
        eq([pend.map(p => Object.keys(p).sort().join()), inv.length, T.state.posReceipts.map(r => [r.no, !!inv[0] && r.invoiceNo === inv[0].no]), /u hodh/.test(B.state.toast || ''), JSON.parse(store.getItem('kontabo.finance.pending') || '[]').length], [['invoices,posReceipts'], 1, [['L-1', true]], false, 0], 'L9: the replayed A4 patch of a legacy receipt is sent (the invoice + the legacy receipt marked with it) — not dropped as a POS patch');
        A._pending = []; A.logout(); B.logout(); done(A); done(B); }
      // ── L10: two tabs migrate; the one whose commit lost (409 — the other tab's migration landed) writes no audit line and shows no dialog
      { const T = mig('rv10'); const Q = mk(); await enter(Q, 'mag', 'rv10');
        const P = mk(); await enter(P, 'own', 'rv10'); await until(() => T.state.posLedgerV === 1 && !P._migrating);
        users.mag.perms = { ...users.mag.perms, pos: true }; Q.state.session = { ...Q.state.session, perms: { ...Q.state.session.perms, pos: true } };
        try { Q.state.confirm = null; const r = await Q.posLedgerMigrate();
          eq([r, T.commits.filter(p => 'posLedgerV' in p).length, T.audit.filter(a => /^Libri i POS-it kaloi në server/.test(a)).length, Q.state.confirm, Q.state.db.posLedgerV], [true, 1, 1, null, 1], 'L10: the tab whose migration commit lost the race reloads the migrated book — no second audit line, no dialog'); }
        finally { users.mag.perms = { stok: true, produkte: true }; }
        P.logout(); Q.logout(); done(P); done(Q); }
      // ── L11: a key created / a token rotated for one company, answered after the switch to another
      { const TA = mkT('rv11a', 'KA SH.P.K.', book(), 'on'), TB = mkT('rv11b', 'KB SH.P.K.', book({ company: { ...book().company, name: 'KB SH.P.K.' } }), 'on'); TA.terms = [{ id: 'tA1', name: 'Arka A', branch: 'Qendra', posId: 'A-1', warehouse: 'W1', status: 'Aktiv', lastSeen: '' }];
        const X = mk(); await enter(X, 'own', 'rv11a'); X.go('settings', 'API'); await X.apiKeysLoad(); const h = hold();
        ctx.fetch = async (url, o = {}) => { if ((/\/api-keys$/.test(url) || /\/rotate$/.test(url)) && o.method === 'POST') { const r = await realFetch(url, o); await h.p; return r; } return realFetch(url, o); };
        const pk = X.apiKeyCreate('Web A', ['pos:read']), pr = X.terminalRotate({ id: 'tA1', name: 'Arka A' }); await wait(5);
        await X.apiSwitchTenant('rv11b'); await until(() => X.state.db.company.name === 'KB SH.P.K.'); X.go('settings', 'API'); await X.apiKeysLoad(); X.state.toast = null; X.state.confirm = null;
        h.open(); const [k, t] = await Promise.all([pk, pr]); ctx.fetch = realFetch;
        eq([k, t, (X.state.apiKeysSrv.items || []).map(x => x.name), X.state.apiSecret, X.state.confirm, X.state.toast, (TA.keys || []).length, TA.rotations, (TB.keys || []).length, X.apiCfg().tenantId], [null, null, [], null, null, null, 1, 1, 0, 'rv11b'], 'L11: the first company\'s new key and rotated token answered after the switch are dropped — never listed or shown on the second company');
        X.logout(); done(X); }
    } finally { ctx.fetch = realFetch; }
    eq([S.bad.slice(bad0), S.noHdr], [[], []], 'mock server (review): no commit carried `_srv` rows or posSync runtime fields, every call had X-Kontabo-Client: 2');
    return H;
  }).catch(e => { console.log('FAIL review tests (E-L) threw: ' + (e && e.stack || e)); process.exitCode = 1; })
// @@AUTO-MONTH@@
// ══ ERP · (1) rifreskimi automatik i listave të kuponëve nga serveri (P:Shitje / P:Kthime / "Kuponët"): çdo POS_LIST_REFRESH ms, në heshtje, me të
// njëjtat filtra dhe po aq rreshta sa janë ngarkuar (mbi 200: në faqe nga 200 njëra pas tjetrës, deri në 1000); (2) rreshtat mujorë të librit të POS-it (kind:'month' — serveri bashkon ditët e një muaji) ══
  .then(async (H) => { if (!H) { console.log('FAIL auto-refresh / month tests skipped: the review block did not finish'); process.exitCode = 1; return; }
    const { S, mkT, pub, tomb, mk, enter, done, wait, until, book, TERM, line, row, rcv, pay, pli, TERM2 } = H, made = [];
    const defer = () => { let open; const p = new Promise(r => (open = r)); return { p, open }; };
    const mkR = () => { const x = mk(), set = x.setState.bind(x); let q = false; x.setState = u => { set(u); if (!q) { q = true; Promise.resolve().then(() => { q = false; x.componentDidUpdate(); }); } }; made.push(x); return x; };
    const settle = async x => { await wait(); await until(() => !x._plT && !x._plRef && !(x.state.posList && x.state.posList.busy) && !(x.state.posRc && x.state.posRc.busy)); await wait(); };
    const rcOf = (tid, k0) => S.calls.slice(k0).filter(x => x.tid === tid && /^\/pos\/receipts(\/|$)/.test(x.p) && x.p !== '/pos/receipts/known').map(x => x.m + ' ' + x.path);
    const Q31 = 'from=2026-08-21&to=2026-09-20', ST = '&status=final%2Creturned%2Cvoid', hhmm = k => String(8 + Math.floor(k / 60)).padStart(2, '0') + ':' + String(k % 60).padStart(2, '0') + ':00';
    const mkRc = (pfx, k) => rcv(pay(pfx + k, 'BAR-1/' + (3000 + k), 'final', [pli('KAFE', 'Kafe', 'copë', 10000, 150)], { time: hhmm(k) }), { seq: k + 1 });
    try {
      // ── (1) auto-refresh
      const Ta = mkT('ta', 'Rifreskimi SH.P.K.', book(), 'on'); Ta.rc = Array.from({ length: 60 }, (_, k) => mkRc('a', k));
      const X = mkR(); X.POS_LIST_REFRESH = 60000; await enter(X, 'own', 'ta'); await settle(X);
      eq([!!X._plRefT, X.posListWant()], [false, null], 'auto-refresh: no timer on the dashboard (no receipt list there)');
      X.go('pos', 'Shitje'); await settle(X);
      eq([!!X._plRefT, X.state.posList.items.length, X.state.posList.total], [true, 50, 60], 'auto-refresh: armed while P:Shitje is the page shown (50 of 60 loaded)');
      let k = S.calls.length; eq([await X.posListRefresh(), rcOf('ta', k)], [true, ['GET /pos/receipts?' + Q31 + ST + '&limit=50&offset=0']], 'refresh: the same filters, limit = the rows loaded (50), offset 0');
      X.pageTable('P:Shitje').more(); await settle(X); X.openPosReceipt('a3'); await settle(X);
      Ta.rc.push(mkRc('a', 500)); const L0 = X.state.posList, dr0 = X.state.dr, rc0 = X.state.posRc, h = defer(); S.rcHold = (tid, path) => (tid === 'ta' && path.startsWith('/pos/receipts?') ? h.p : null);
      k = S.calls.length; const pr = X.posListRefresh(); await wait(); const mid = [X.state.posList === L0, X.pageTable('P:Shitje').rows.length, X.state.posList.busy, X.pageTable('P:Shitje').count];
      S.rcHold = null; h.open(); const ok = await pr; await wait(); const T = X.pageTable('P:Shitje');
      eq([mid, ok, rcOf('ta', k), X.state.posList.items.length, X.state.posList.items[0].id, T.count, T.hasMore, X.state.posList.pages, X.state.posList.key === L0.key, X.state.dr === dr0, X.state.posRc === rc0, X.drawerVals().no],
        [[true, 60, false, '60'], true, ['GET /pos/receipts?' + Q31 + ST + '&limit=60&offset=0'], 60, 'a500', '61', true, 2, true, true, true, 'BAR-1/3003'],
        'refresh after "Shfaq më shumë": silent (no spinner, the 60 rows stay while it reads), limit 60 offset 0 → the new receipt on top, 60 rows kept, 61 in total; the pages, the filters and the open drawer untouched');
      ctx.document.visibilityState = 'hidden'; k = S.calls.length; const hid = await X.posListRefresh(); ctx.document.visibilityState = 'visible';
      eq([hid, rcOf('ta', k), await X.posListRefresh()], [false, [], true], 'a hidden browser tab (document.visibilityState) asks nothing; visible again → it reads');
      const h1 = defer(); S.rcHold = (tid, path) => (tid === 'ta' && path.startsWith('/pos/receipts?') ? h1.p : null); X.posListSync(true); await until(() => X.state.posList.busy);
      k = S.calls.length; const busy = await X.posListRefresh(); S.rcHold = null; h1.open(); await settle(X);
      eq([busy, rcOf('ta', k)], [false, []], 'a load on its way ("Rifresko", a filter, "Shfaq më shumë"): the timer asks nothing');
      let first = true; const h2 = defer(); S.rcHold = (tid, path) => (tid === 'ta' && path.startsWith('/pos/receipts?') && first ? ((first = false), h2.p) : null);
      const p1 = X.posListRefresh(); await wait(); k = S.calls.length; const again = [await X.posListRefresh(), X._plRef, rcOf('ta', k)];
      X.posFilter({ terminal: TERM2.key }); await until(() => !X.state.posList.busy && X.state.posList.base.includes(TERM2.key)); S.rcHold = null; h2.open();
      eq([again, await p1, X.state.posList.items.length, X.state.posList.base.includes(TERM2.key)], [[false, true, []], false, 0, true], 'one refresh at a time; an answer that arrives after the filter changed is dropped (the new filter\'s list stays)');
      X.posFilter({ terminal: TERM.key }); await settle(X); k = S.calls.length; await X.posListRefresh();
      eq(rcOf('ta', k), ['GET /pos/receipts?' + Q31 + '&terminal=' + TERM.key + ST + '&limit=50&offset=0'], 'the refresh keeps the terminal filter');
      X.posFilter({ terminal: '' }); await settle(X);
      Ta.rcDeny = true; X.posListSync(true); await settle(X); k = S.calls.length; const den = [X.state.posList.code, await X.posListRefresh(), rcOf('ta', k)]; Ta.rcDeny = false; X.posListSync(true); await settle(X);
      eq(den, [403, false, []], 'a refused list (403) is not re-read by the timer ("Rifresko" asks again)');
      X.setState({ section: 'settings', page: 'Fiskalizimi', fiscalTab: 'Kuponët' }); await settle(X); k = S.calls.length;
      eq([!!X._plRefT, await X.posListRefresh(), rcOf('ta', k)], [true, true, ['GET /pos/receipts?fiscal=open&from=2025-09-21&to=2026-09-20&limit=50&offset=0']], 'the fiscal monitor\'s "Kuponët" tab refreshes the same way');
      X.go('dashboard', 'Paneli'); await settle(X); eq([!!X._plRefT, await X.posListRefresh()], [false, false], 'leaving the list page stops the timer; nothing to refresh');
      // the real timer (POS_LIST_REFRESH short): re-reads while the page is shown, never faster, never a loop; stops on leaving / company switch / logout
      X.POS_LIST_REFRESH = 25; X.go('pos', 'Kthime'); await settle(X); X.openPosReceipt('a5'); await settle(X); k = S.calls.length; const t0 = RealDate.now(); await wait(300); await settle(X); const auto = rcOf('ta', k), el = RealDate.now() - t0;
      eq([auto.length >= 2 && auto.length <= Math.floor(el / 25) + 1, [...new Set(auto)], X.state.dr && X.state.dr.id, X.state.page], [true, ['GET /pos/receipts?' + Q31 + '&status=return%2Ccancel&limit=50&offset=0'], 'a5', 'Kthime'], 'P:Kthime left open: re-read every 25 ms (' + auto.length + '× in ' + el + ' ms — never more often) with the same query, the open drawer stays');
      X.go('dashboard', 'Paneli'); await settle(X); k = S.calls.length; await wait(120); eq([rcOf('ta', k), !!X._plRefT], [[], false], 'the timer stops when the page is left');
      X.go('pos', 'Shitje'); await settle(X); const armed = !!X._plRefT; await X.apiSwitchTenant('t1'); await until(() => X._ledger && X._ledger.tenantId === 't1' && X._ledger.loaded); k = S.calls.length; await wait(120);
      eq([armed, rcOf('ta', k), X.apiCfg().tenantId], [true, [], 't1'], 'company switch: the old company\'s list is never re-read');
      X.go('pos', 'Shitje'); await settle(X); const armed2 = !!X._plRefT; X.logout(); await wait(); k = S.calls.length; await wait(120);
      eq([armed2, !!X._plRefT, S.calls.slice(k).filter(c => /^\/pos\/receipts/.test(c.p)).length], [true, false, 0], 'logout stops the timer'); done(X);
      // more than 200 rows loaded: EVERY loaded row re-read in sequential pages of 200 (offset 0, 200, 400, …; at most 1000 rows = 5 requests)
      const Tb = mkT('tb', 'Dyqind SH.P.K.', book(), 'on'); Tb.rc = Array.from({ length: 230 }, (_, i) => mkRc('b', i));
      const Y = mkR(); Y.POS_LIST_REFRESH = 60000; Y.POS_LIST_PAGE = 200; await enter(Y, 'own', 'tb'); Y.go('pos', 'Shitje'); await settle(Y); Y.pageTable('P:Shitje').more(); await settle(Y);
      Tb.rc.push(mkRc('b', 400), mkRc('b', 401)); const n0 = Y.state.posList.items.length; k = S.calls.length; await Y.posListRefresh(); const ids = Y.state.posList.items.map(x => x.id);
      eq([n0, rcOf('tb', k), ids.length, new Set(ids).size, ids.slice(0, 2), [...ids].sort().join() === Tb.rc.map(x => x.id).sort().join(), Y.pageTable('P:Shitje').count], [230, [0, 200].map(o => 'GET /pos/receipts?' + Q31 + ST + '&limit=200&offset=' + o), 232, 232, ['b401', 'b400'], true, '232'],
        '230 rows loaded: the refresh reads them in 2 pages of 200 (offset 0, 200) — every receipt once, the 2 new ones on top (232)');
      Y.logout(); done(Y);
      // 450 of 600 loaded (3 × "Shfaq më shumë" of 150): the server's row n = c(599 − n)
      const Tc = mkT('tc', 'Katërqind SH.P.K.', book(), 'on'); Tc.rc = Array.from({ length: 600 }, (_, i) => mkRc('c', i));
      const pg = (n, lim = 200) => Array.from({ length: n }, (_, i) => 'GET /pos/receipts?' + Q31 + ST + '&limit=' + lim + '&offset=' + i * 200), pg3 = pg(3);
      const setSt = (T, id, st, lbl) => { const r = T.rc.find(x => x.id === id); r.status = st; r.statusLabel = lbl; r.payload.status = st; };
      const at = (a, i) => (a && a[i]) || {}, srvIds = T => T.rc.filter(x => ['final', 'returned', 'void'].includes(x.status)).sort((a, b) => b.ts.localeCompare(a.ts) || b.seq - a.seq).map(x => x.id), hold2 = (tid, h) => { S.rcHold = (t, path) => (t === tid && /^\/pos\/receipts\?.*&offset=200$/.test(path) ? h.p : null); };
      const Z = mkR(); Z.POS_LIST_REFRESH = 60000; Z.POS_LIST_PAGE = 150; await enter(Z, 'own', 'tc'); Z.go('pos', 'Shitje'); await settle(Z); Z.pageTable('P:Shitje').more(); await settle(Z); Z.pageTable('P:Shitje').more(); await settle(Z);
      Z.openPosReceipt('c590'); await settle(Z); setSt(Tc, 'c249', 'returned', 'Kthyer');
      const r350 = () => [at(Z.state.posList.items, 350).id, at(Z.state.posList.items, 350).statusLabel, at(at(Z.pageTable('P:Shitje').rows, 350).cells, 9).t];
      const Lz = Z.state.posList, b350 = r350(), dz = Z.state.dr, rz = Z.state.posRc, fz0 = JSON.stringify(Z.posF()), pz = JSON.stringify(Z.state.posPages);
      k = S.calls.length; const okz = await Z.posListRefresh(); let Tz = Z.pageTable('P:Shitje');
      eq([Lz.items.length, Lz.total, b350, okz, rcOf('tc', k), Z.state.posList.items.length, Z.state.posList.items.map(x => x.id).join() === Lz.items.map(x => x.id).join(), r350(), Tz.count, Tz.moreLabel, Z.state.posList.pages, Z.state.dr === dz, Z.state.posRc === rz, JSON.stringify(Z.posF()) === fz0, JSON.stringify(Z.state.posPages) === pz, Z.drawerVals().no],
        [450, 600, ['c249', 'Finalizuar', 'Në rregull'], true, pg3, 450, true, ['c249', 'Kthyer', 'Kthyer'], '600', 'Shfaq më shumë (150 nga 150 të tjerë)', 3, true, true, true, true, 'BAR-1/3590'],
        '450 of 600 loaded: the refresh asks 3 pages (offset 0 / 200 / 400, limit 200) — the status change on row 350 shows up; the same 450 rows (the 150 read past them are not added), "Shfaq më shumë" as before; the filters, the pages and the open drawer untouched');
      // a failure on page 2: nothing applied, page 3 never asked
      const realF = ctx.fetch; setSt(Tc, 'c400', 'void', 'Anuluar'); let f2, L1;
      try { ctx.fetch = async (url, o = {}) => { const r = await realF(url, o); return /\/pos\/receipts\?.*&offset=200$/.test(url) ? { ok: false, status: 500, json: async () => ({ error: 'internal', message: 'Gabim i brendshëm' }) } : r; };
        L1 = Z.state.posList; k = S.calls.length; f2 = await Z.posListRefresh(); } finally { ctx.fetch = realF; }
      eq([f2, rcOf('tc', k), Z.state.posList === L1, at(Z.state.posList.items, 199).id, at(Z.state.posList.items, 199).statusLabel, Z._plRef, Z.state.posList.err], [false, pg(2), true, 'c400', 'Finalizuar', false, ''], 'a failure on page 2 (HTTP 500): nothing applied — the old rows stay (row 199 not "Anuluar" yet), page 3 never asked, no error shown');
      // the list changed between two pages (a receipt arrived while page 2 was on its way: the total moved 600 → 601): nothing applied; the next refresh applies it
      let hz = defer(); hold2('tc', hz); k = S.calls.length; let pr2 = Z.posListRefresh(); await until(() => rcOf('tc', k).length === 2); Tc.rc.push(mkRc('c', 940)); S.rcHold = null; hz.open();
      const moved = [await pr2, rcOf('tc', k), Z.state.posList === L1]; k = S.calls.length; const ok2 = await Z.posListRefresh(), it2 = Z.state.posList.items;
      eq([moved, ok2, rcOf('tc', k), it2.length, at(it2, 0).id, at(it2, 200).id, at(it2, 200).statusLabel, Z.pageTable('P:Shitje').count], [[false, pg(2), true], true, pg3, 451, 'c940', 'c400', 'Anuluar', '601'],
        'a receipt that arrives between two pages (total 600 → 601): that refresh applies nothing and asks no page 3; the next one applies it — the new receipt on top, 451 rows, row 199 (now 200) "Anuluar", 601 in total');
      // one refresh at a time: a second one while page 2 is on its way asks nothing; a hidden browser tab asks no page
      hz = defer(); hold2('tc', hz); k = S.calls.length; pr2 = Z.posListRefresh(); await until(() => rcOf('tc', k).length === 2); let k2 = S.calls.length; const two = [await Z.posListRefresh(), Z._plRef, rcOf('tc', k2)]; S.rcHold = null; hz.open();
      const one = [await pr2, rcOf('tc', k)]; ctx.document.visibilityState = 'hidden'; k = S.calls.length; const hid2 = [await Z.posListRefresh(), rcOf('tc', k)]; ctx.document.visibilityState = 'visible';
      eq([two, one, hid2], [[false, true, []], [true, pg3], [false, []]], '451 rows: one refresh at a time (a second one while page 2 is on its way asks nothing, the first one asks its 3 pages); a hidden browser tab asks no page');
      // a receipt on top AND another leaving the list (cancelled) between two pages: the total stays 601, page 2 repeats page 1's last row — no receipt twice
      hz = defer(); hold2('tc', hz); k = S.calls.length; pr2 = Z.posListRefresh(); await until(() => rcOf('tc', k).length === 2); Tc.rc.push(mkRc('c', 960)); setSt(Tc, 'c10', 'cancel', 'Anulim'); S.rcHold = null; hz.open();
      const okd = await pr2, cd = rcOf('tc', k), idd = Z.state.posList.items.map(x => x.id); setSt(Tc, 'c10', 'final', 'Finalizuar'); await Z.posListRefresh(); const idd2 = Z.state.posList.items.map(x => x.id);
      eq([okd, cd, idd.length, new Set(idd).size, idd[0], idd[idd.length - 1], idd2.length, idd2.slice(0, 2), idd2.join() === srvIds(Tc).slice(0, 452).join(), Z.pageTable('P:Shitje').count], [true, pg3, 451, 451, 'c940', 'c150', 452, ['c960', 'c940'], true, '602'],
        'a receipt on top and another one cancelled between two pages (the total unchanged, page 2 repeats a row): every receipt once, the same 451; the next refresh brings the new one on top (452)');
      // new receipts on top: the loaded count grows by them; "Shfaq më shumë" goes on from the server's next row — and wins over a refresh on its way
      Tc.rc.push(mkRc('c', 970), mkRc('c', 971), mkRc('c', 972)); k = S.calls.length; await Z.posListRefresh(); Tz = Z.pageTable('P:Shitje'); const top = Z.state.posList.items.map(x => x.id), nt = [rcOf('tc', k), top.length, top.slice(0, 4), top.join() === srvIds(Tc).slice(0, 455).join(), Tz.count, Tz.moreLabel];
      hz = defer(); hold2('tc', hz); k = S.calls.length; pr2 = Z.posListRefresh(); await until(() => rcOf('tc', k).length === 2); Tz.more(); await until(() => !Z.state.posList.busy && Z.state.posList.items.length > 455); S.rcHold = null; hz.open();
      const late = await pr2, allz = Z.state.posList.items.map(x => x.id);
      eq([nt, late, rcOf('tc', k), allz.length, new Set(allz).size, allz.join() === srvIds(Tc).join(), Z.state.posList.pages, Z.pageTable('P:Shitje').hasMore],
        [[pg3, 455, ['c972', 'c971', 'c970', 'c960'], true, '605', 'Shfaq më shumë (150 nga 150 të tjerë)'], false, [...pg(2), 'GET /pos/receipts?' + Q31 + ST + '&limit=150&offset=455'], 605, 605, true, 4, false],
        '3 new receipts: on top, every loaded row kept (452 → 455 = the server\'s first 455), 605 in total; "Shfaq më shumë" while a refresh is on its way goes on from offset 455 and the late refresh is dropped (no page 3) — every receipt of the server once, in its order');
      // a load on its way ("Rifresko") / a refused list (403): the timer asks nothing
      hz = defer(); S.rcHold = (t, path) => (t === 'tc' && path.startsWith('/pos/receipts?') ? hz.p : null); Z.posListSync(true); await until(() => Z.state.posList.busy);
      k = S.calls.length; const bz = [await Z.posListRefresh(), rcOf('tc', k)]; S.rcHold = null; hz.open(); await settle(Z);
      Tc.rcDeny = true; Z.posListSync(true); await settle(Z); k = S.calls.length; const dz2 = [Z.state.posList.code, await Z.posListRefresh(), rcOf('tc', k)]; Tc.rcDeny = false; Z.posListSync(true); await settle(Z);
      eq([bz, dz2], [[false, []], [403, false, []]], 'many rows: a load on its way and a refused list (403) are not re-read by the timer');
      // a company switch while page 2 is on its way: the answer is dropped, no page 3 is asked
      Z.pageTable('P:Shitje').more(); await settle(Z); Z.pageTable('P:Shitje').more(); await settle(Z); const n500 = Z.state.posList.items.length; setSt(Tc, 'c599', 'void', 'Anuluar');
      hz = defer(); hold2('tc', hz); k = S.calls.length; pr2 = Z.posListRefresh(); await until(() => rcOf('tc', k).length === 2);
      await Z.apiSwitchTenant('t1'); await until(() => Z._ledger && Z._ledger.tenantId === 't1' && Z._ledger.loaded); S.rcHold = null; hz.open(); const sw = await pr2; await wait(20);
      eq([n500, sw, rcOf('tc', k), S.calls.slice(k).filter(c => /^\/pos\/receipts$/.test(c.p) && /&offset=400$/.test(c.path)).length, Z.apiCfg().tenantId, ((Z.state.posList || {}).items || []).some(x => /^c\d+$/.test(x.id))], [500, false, pg(2), 0, 't1', false],
        'a company switch while page 2 of 3 is on its way: the old company\'s answer is dropped (never shown on the new company), page 3 never asked (of either company)');
      Z.logout(); done(Z);
      // the cap: 1200 of 1300 loaded → 5 pages (rows 0–999, 1000 = the cap); the rows loaded past it kept after the last row both lists share
      const Td = mkT('td', 'Njëmijë SH.P.K.', book(), 'on'); Td.rc = Array.from({ length: 1300 }, (_, i) => mkRc('d', i));
      const W = mkR(); W.POS_LIST_REFRESH = 60000; W.POS_LIST_PAGE = 200; await enter(W, 'own', 'td'); W.go('pos', 'Shitje'); await settle(W); for (let i = 0; i < 5; i++) { W.pageTable('P:Shitje').more(); await settle(W); }
      const n1200 = W.state.posList.items.length; setSt(Td, 'd799', 'returned', 'Kthyer'); setSt(Td, 'd199', 'returned', 'Kthyer'); Td.rc.push(mkRc('d', 2000), mkRc('d', 2001)); // rows 500 and 1100 change, 2 new on top
      k = S.calls.length; const okw = await W.posListRefresh(), iw = W.state.posList.items, iwIds = iw.map(x => x.id), Tw = W.pageTable('P:Shitje');
      eq([n1200, okw, rcOf('td', k), iw.length, new Set(iwIds).size, iwIds.slice(0, 3), [at(iw, 502).id, at(iw, 502).statusLabel], [at(iw, 1102).id, at(iw, 1102).statusLabel], iwIds.join() === srvIds(Td).slice(0, 1202).join(), Tw.count, Tw.moreLabel],
        [1200, true, pg(5), 1202, 1202, ['d2001', 'd2000', 'd1299'], ['d799', 'Kthyer'], ['d199', 'Finalizuar'], true, '1302', 'Shfaq më shumë (100 nga 100 të tjerë)'],
        '1200 rows loaded: at most 5 pages (offset 0 … 800, 1000 rows) — row 500\'s change shows up, the 200 rows past the cap kept as loaded after the overlap (row 1100 unchanged), the 2 new ones on top (1202, the server\'s order), 1302 in total');
      k = S.calls.length; Tw.more(); await settle(W); const wAll = W.state.posList.items.map(x => x.id);
      eq([rcOf('td', k), wAll.length, new Set(wAll).size, wAll.join() === srvIds(Td).join()], [['GET /pos/receipts?' + Q31 + ST + '&limit=200&offset=1202'], 1302, 1302, true], 'past the cap "Shfaq më shumë" still goes on from the server\'s next row (offset 1202) — every receipt once');
      // the real timer with many rows: every cycle asks its 5 pages in order, cycles never overlap
      W.posListAutoStop(); W.POS_LIST_REFRESH = 25; W.posListAuto(); k = S.calls.length; await wait(300); W.POS_LIST_REFRESH = 60000; W.posListAutoStop(); await until(() => !W._plRef); W.posListAutoStop(); const cyc = rcOf('td', k);
      eq([cyc.length >= 5, cyc.length % 5, cyc.every((p, i) => p === pg(5)[i % 5])], [true, 0, true], 'the timer with 1302 rows loaded: ' + cyc.length / 5 + ' cycles of 5 pages (offset 0 … 800), in order, never overlapping');
      // a short page ends the list: no page after it, and the rows loaded past the cap are not kept when the server's list ended before it
      Td.rc = Td.rc.filter(x => !/^d\d+$/.test(x.id) || +x.id.slice(1) >= 1000); k = S.calls.length; const oke = await W.posListRefresh(), ie = W.state.posList.items.map(x => x.id), Te = W.pageTable('P:Shitje');
      eq([oke, rcOf('td', k), ie.length, ie.join() === srvIds(Td).join(), Te.count, Te.hasMore], [true, pg(2), 302, true, '302', false], 'the server\'s list shrank to 302 (rows left the filter): page 2 is short → no page 3, the 1000 rows past it dropped — the rows are the server\'s, no "Shfaq më shumë"');
      W.logout(); done(W);
      // local mode / no server list: never a timer
      { const Lc = new C({}); Lc._api = { url: '', accessToken: '', refreshToken: '', version: 0, tenantId: '', tenantName: '', tenants: [], remember: true, status: '', lastError: '' }; Lc.state.db = Lc.seedDb(); Lc.state.session = { name: 'Arben Berisha', role: 'Pronar', userId: 'u1' };
        Lc.go('pos', 'Shitje'); Lc.componentDidUpdate(); eq([!!Lc._plRefT, await Lc.posListRefresh()], [false, false], 'local mode: P:Shitje is the book\'s list — no auto-refresh'); clearTimeout(Lc._t); }

      // ── (2) month rows: the mock server merges one terminal's day rows of a closed month like kontabo-backend does — ONE row kind 'month'
      // (id M:<terminal>:<YYYY-MM>, date = the month's last day, no POS-<posId>-<YYYYMM>-<key6>: items / moves / payments grouped and summed,
      // totals / counts / n / operators / fiscal summed, fiscalOpen joined, first / last time) and publishes the day rows as tombstones
      const lastDay = ym => ym + '-' + String(new RealDate(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0');
      const compactMonth = (T, key6, ym) => { const days = [...T.led.rows.values()].filter(r => !r.removed && r.kind === 'day' && r.id.startsWith('D:' + key6 + ':' + ym + '-')).sort((a, b) => a.date.localeCompare(b.date)); if (!days.length) return null;
        const t = days[0].terminal, grp = (list, keyOf, sum) => { const m = new Map(); for (const x of list) { const k = keyOf(x), y = m.get(k); if (!y) m.set(k, { ...x }); else for (const f of sum) y[f] = (y[f] || 0) + (x[f] || 0); } return [...m.values()]; };
        const add = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v; return o; }, ops = {};
        for (const d of days) for (const [n, o] of Object.entries(d.operators || {})) ops[n] = add(ops[n] || {}, o);
        const items = grp(days.flatMap(d => d.items), i => [i.sku, i.tax, i.rate, i.unit, i.name, !!i.recipe].join('|'), ['qty_q', 'sub_c', 'vat_c', 'tot_c', 'disc_c']).map(i => ({ ...i, unit_t: i.qty_q ? Math.round(i.sub_c * 1e6 / i.qty_q) : 0 }));
        const m = { id: 'M:' + key6 + ':' + ym, kind: 'month', rev: 0, removed: false, date: lastDay(ym), firstTs: days[0].firstTs, lastTs: days.map(d => d.lastTs).sort().pop(), terminal: t, no: 'POS-' + t.posId + '-' + ym.replace('-', '') + '-' + key6, status: 'Finalizuar', items,
          moves: grp(days.flatMap(d => d.moves), x => [x.sku, x.wh, x.cost_c, x.type, x.via].join('|'), ['qm']), payments: grp(days.flatMap(d => d.payments), x => x.account + '|' + x.kind, ['amount_c']),
          totals: days.reduce((a, d) => add(a, d.totals), {}), counts: days.reduce((a, d) => add(a, d.counts), {}), n: days.reduce((a, d) => a + d.n, 0), operators: ops, fiscal: days.reduce((a, d) => add(a, d.fiscal), {}), fiscalOpen: days.flatMap(d => d.fiscalOpen || []).slice(0, 50), noVat: days.every(d => d.noVat) };
        pub(T, m); for (const d of days) tomb(T, d.id); return m; };
      const Tm = mkT('tm', 'Mujore SH.P.K.', book(), 'on'); Tm.terms = [{ id: TERM.id, name: 'Arka Bar', branch: 'Qendra', posId: 'BAR-1', warehouse: 'W2', status: 'Aktiv', lastSeen: '' }, { id: TERM2.id, name: 'Arka 2', branch: 'Qendra', posId: 'BAR-2', warehouse: 'W1', status: 'Aktiv', lastSeen: '' }];
      const A03 = row('D:k1a2b3:2026-08-03', 'day', '2026-08-03', { n: 2, counts: { receipts: 2, returns: 0, cancels: 0, voided: 0 }, items: [line('KAFE', 'Kafe', 'copë', 20000, 300, 35)], moves: [['KAFE', -2000, 35, 'sale']], pays: [['cash1', 'cash', 300]] });
      const A15 = row('D:k1a2b3:2026-08-15', 'day', '2026-08-15', { n: 3, counts: { receipts: 3, returns: 0, cancels: 0, voided: 0 }, items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 35), line('MOJ', 'Mojito', 'gotë', 10000, 500, 80, true), line('UJE', 'Ujë', 'shishe', 10000, 100, 20)],
        moves: [['KAFE', -1000, 35, 'sale'], ['RUM', -40, 2000, 'sale', 'MOJ'], ['UJE', -1000, 20, 'sale']], pays: [['cash1', 'cash', 350], ['bank1', 'card', 400]], fiscal: { fiscalized: 2, failed: 1 }, fiscalOpen: [{ id: 'fx', no: 'BAR-1/0800', ts: '2026-08-15 12:00:00', status: 'failed', error: 'ATK: 500' }],
        extra: { operators: { Ana: { count: 2, total_c: 400, returns_c: 0, cancels_c: 0 }, Besa: { count: 1, total_c: 350, returns_c: 0, cancels_c: 0 } } } });
      const A31 = row('D:k1a2b3:2026-08-31', 'day', '2026-08-31', { n: 1, counts: { receipts: 0, returns: 1, cancels: 0, voided: 0 }, items: [line('UJE', 'Ujë', 'shishe', -20000, -200, 20)], moves: [['UJE', 2000, 20, 'sale_return']], pays: [['cash1', 'cash', -200]], extra: { operators: { Ana: { count: 1, total_c: -200, returns_c: 200, cancels_c: 0 } } } });
      const RA = row('R:r-aug', 'receipt', '2026-08-20', { no: 'BAR-1/0820', time: '12:00:00', items: [line('KAFE', 'Kafe', 'copë', 40000, 600, 35)], moves: [['KAFE', -4000, 35, 'sale']], pays: [['cash1', 'cash', 600]], extra: { customer: 'Drini Market SH.P.K.', nui: '811234500', operator: 'Ana', origId: null, origNo: null, fiscalRef: 'TX-88' } });
      const B10 = row('D:k2b3c4:2026-08-10', 'day', '2026-08-10', { no: 'POS-BAR-2-20260810-k2b3c4', items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 35)], moves: [['KAFE', -1000, 35, 'sale']], pays: [['cash1', 'cash', 150]], extra: { terminal: TERM2 } });
      const S20 = row('D:k1a2b3:2026-09-20', 'day', '2026-09-20', { items: [line('KAFE', 'Kafe', 'copë', 10000, 150, 35)], moves: [['KAFE', -1000, 35, 'sale']], pays: [['cash1', 'cash', 150]] });
      for (const r of [A03, A15, A31, RA, B10, S20]) pub(Tm, JSON.parse(JSON.stringify(r)));
      const M = mkR(); M.POS_LIST_REFRESH = 60000; await enter(M, 'own', 'tm'); await settle(M);
      const cellsT = r => r.cells.map(c => c.t);
      const snap = x => { const out = {}, keep = (k, v) => { out[k] = JSON.stringify(v); }, st0 = { section: x.state.section, page: x.state.page, rp: x.state.rp, rTab: x.state.rTab, range: x.state.range };
        const tb = (pg, st) => { Object.assign(x.state, st); const t = x.pageTable(pg); return { rows: t.rows.map(cellsT), subs: t.rows.map(r => r.cells.map(c => c.sub || '')), foot: (t.foot || []).map(c => c.t), kpis: (t.kpis || []).map(k => [k.label, k.value, k.sub || '']), count: t.count }; };
        keep('stock', ['KAFE', 'UJE', 'RUM', 'LIM', 'MOJ'].map(s => [x.stockOf(s), x.stockOfWh(s, 'W1'), x.stockOfWh(s, 'W2'), x.avgCost(x.view(), s)]));
        keep('accounts', ['cash1', 'cash2', 'bank1'].map(a => x.accountBalance(a))); const B = x.balances(); keep('balances', Object.keys(B).sort().map(c => [c, B[c].bal]));
        const sd = x.salesDocs(); keep('salesDocs', ['sub', 'vat', 'total', 'n'].map(k => sd.reduce((a, r) => a + (Number(r[k]) || 0), 0))); keep('cogs', x.cogsOf(x.view().movements));
        for (const rp of ['all', 'year', 'prev', 'month']) { for (const tab of ['Sipas klientit', 'Sipas artikullit', 'Sipas muajit']) keep('R:Shitje ' + rp + ' / ' + tab, tb('R:Shitje', { section: 'raporte', page: 'Shitje', rp, rTab: tab })); keep('R:TVSH ' + rp, tb('R:TVSH', { section: 'raporte', page: 'TVSH', rp, rTab: 'Përmbledhje' })); keep('P:Operatorët ' + rp, tb('P:Operatorët', { section: 'pos', page: 'Operatorët', rp, rTab: '' })); }
        keep('P:Arkat', (t => ({ ...t, kpis: t.kpis.filter(q => q[0] !== 'Libri i POS-it në server') }))(tb('P:Arkat', { section: 'pos', page: 'Arkat' }))); // (that KPI shows the ledger's rev) keep('Cilësime › POS', x.settingsPage('POS').cards.find(c => c.title === 'Terminalet').table.rows.map(cellsT)); keep('fiscal fails', x.ledgerFiscalFails());
        for (const range of ['Sot', 'Këtë javë', 'Këtë muaj', 'Këtë vit', 'Gjithçka']) { Object.assign(x.state, { section: 'dashboard', page: 'Paneli', range }); const v = x.renderVals(); keep('dashboard ' + range, [v.kpis.map(k => [k.label, k.value, k.sub]), v.chart.map(c => [c.label, c.sh, c.v])]); }
        Object.assign(x.state, st0); return out; };
      const before = snap(M), v0 = M.view();
      eq([M._ledger.rows.size, v0.posReceipts.filter(r => r._srv).map(r => r.id)], [6, ['D:k1a2b3:2026-09-20', 'D:k1a2b3:2026-08-31', 'R:r-aug', 'D:k1a2b3:2026-08-15', 'D:k2b3c4:2026-08-10', 'D:k1a2b3:2026-08-03']], 'month rows: the company\'s ledger before the merge — August as 3 + 1 day rows and a receipt row');
      const MR = compactMonth(Tm, 'k1a2b3', '2026-08'); await M.ledgerTick(); await settle(M);
      const v = M.view(), docs = v.posReceipts.filter(r => r._srv), md = docs.find(r => r.id === 'M:k1a2b3:2026-08');
      eq([[...M._ledger.rows.keys()].sort(), docs.map(r => r.id)], [['D:k1a2b3:2026-09-20', 'D:k2b3c4:2026-08-10', 'M:k1a2b3:2026-08', 'R:r-aug'], ['D:k1a2b3:2026-09-20', 'M:k1a2b3:2026-08', 'R:r-aug', 'D:k2b3c4:2026-08-10']], 'the tombstones drop the three day rows, the month row takes their place (the other terminal\'s day and the receipt row stay)');
      eq([md.summary, md.month, md.no, md.date, md.isoDate, md.n, md.customer, md.operator, md.total, md.cash_c, md.card_c, md.fiscal, md.fiscalOpen.length, md.items.map(i => [i.sku, i.qty, i.tot, i.recipe])],
        [true, true, 'POS-BAR-1-202608-k1a2b3', '31.08.2026', '2026-08-31', 6, 'Klient me shumicë', '—', 850, 450, 400, 'Dështoi', 1, [['KAFE', 3, 450, false], ['MOJ', 1, 500, true], ['UJE', -1, -100, false]]], 'the month document: a summary dated the month\'s last day, n = 6 receipts, the month\'s net items, totals and the worst fiscal state');
      eq([v.payments.filter(p => p.docId === md.id).map(p => [p.no, p.dir, p.amount_c, p.account, p.date, p.note]), v.movements.filter(m => m.docId === md.id).map(m => [m.type, m.sku, m.qm, m.unit_c, m.via, m.ref, m.note, m.date])],
        [[['POS-202608-k1a2b3', 'in', 450, 'cash1', '31.08.2026', 'Përmbledhje mujore POS · para'], ['POS-202608-k1a2b3K', 'in', 400, 'bank1', '31.08.2026', 'Përmbledhje mujore POS · kartë']],
          [['sale', 'KAFE', -3000, 35, null, MR.no, 'POS · përmbledhje mujore', '31.08.2026'], ['sale', 'RUM', -40, 2000, 'MOJ', MR.no, 'POS · përmbledhje mujore', '31.08.2026'], ['sale', 'UJE', -1000, 20, null, MR.no, 'POS · përmbledhje mujore', '31.08.2026'], ['sale_return', 'UJE', 2000, 20, null, MR.no, 'POS · përmbledhje mujore', '31.08.2026']]],
        'month payments POS-<YYYYMM>-<key6> (+K for the card), the month\'s movements (docId = the month row) at their frozen costs');
      { const J = M.journal(), of = re => J.filter(e => e.ref === MR.no && re.test(e.desc)).map(e => [e.desc, e.lines]);
        eq([of(/^Përmbledhje mujore POS/), of(/^Kosto e mallit/), J.some(e => [A03.no, A15.no, A31.no].includes(e.ref)), MR.totals.sub_c + MR.totals.vat_c],
          [[['Përmbledhje mujore POS · Klient me shumicë · Arka Bar', [['1000', 450, 0], ['1010', 400, 0], ['4000', 0, MR.totals.sub_c], ['2400', 0, MR.totals.vat_c]]]], [['Kosto e mallit · kupon POS', [['5000', 165, 0], ['1300', 0, 165]]]], false, 850], 'journal: "Përmbledhje mujore POS" — cash, card, revenue, VAT and the cost of goods (105 + 80 + 20 − 40) of the month; nothing left of the day rows'); }
      const after = snap(M), diff = Object.keys(before).filter(k => before[k] !== after[k]);
      for (const kk of diff) console.log('     (' + kk + ') before: ' + before[kk] + ' · after: ' + after[kk]);
      eq(diff, [], 'the month row replaces its day rows with identical totals: stock (per warehouse), average cost, cash / bank, balances, sales documents (n), cost of goods, R:Shitje (by customer / article / month), R:TVSH, P:Operatorët, P:Arkat, Cilësime › POS, the fiscal failures and the dashboard (every period) — ' + Object.keys(before).length + ' views compared');
      // the drawer of a month summary; "Shiko kuponat e muajit" → P:Shitje filtered by that terminal over the whole month
      M.openDr('pos', md.id); let D = M.drawerVals();
      eq([M.state.dr, D.title, D.subtitle, D.no, D.badge.text, D.actions.map(a => a.label), D.meta.slice(0, 3).map(m => [m.k, m.v]), D.sections.map(s => s.title), D.sections[0].rows.map(cellsT), /^Përmbledhje e një muaji të mbyllur/.test(D.note)],
        [{ kind: 'pos', id: md.id }, 'Përmbledhje mujore · Arka Bar', 'Gusht 2026 · Qendra · 6 kupona · 03.08–31.08', MR.no, '1 pa fiskalizuar', ['Shiko kuponat e muajit'], [['Muaji', 'Gusht 2026'], ['Arka', 'Arka Bar · BAR-1'], ['Kupona gjithsej', '6']], ['Operatorët', 'Fiskalizimi', 'Kuponët pa u fiskalizuar', 'Artikujt (neto e muajit)', 'Pagesat'], [['Ana', '5', '€5.00', '-€2.00', '—'], ['Besa', '1', '€3.50', '—', '—']], true],
        'month summary drawer: "Përmbledhje mujore", the month, its receipts and first–last day, the operators summed over the month; no A4');
      k = S.calls.length; D.actions[0].go(); await settle(M); const TS = M.pageTable('P:Shitje');
      eq([M.state.page, M.state.dr, rcOf('tm', k), TS.period.filter(p => p.on).map(p => p.label), TS.filters.find(f => f.title === 'Arka').value], ['Shitje', null, ['GET /pos/receipts?from=2026-08-01&to=2026-08-31&terminal=' + TERM.key + ST + '&limit=50&offset=0'], ['01.08.2026 – 31.08.2026'], TERM.key], '"Shiko kuponat e muajit" → P:Shitje filtered by that terminal from the 1st to the last day of the month');
      M.openDr('pos', 'D:k2b3c4:2026-08-10'); D = M.drawerVals(); eq([D.title, D.actions.map(a => a.label), D.meta[0].k], ['Përmbledhje ditore · Arka 2', ['Shiko kuponat e ditës'], 'Data'], 'a day summary stays a day summary'); M.setState({ dr: null });
      // P:Shitje / P:Arkat "today": a month row (dated its month's last day) never counts as today
      const kp = () => { M.go('pos', 'Arkat'); const a = M.pageTable('P:Arkat').rows.map(r => [r.cells[7].t, r.cells[8].t]); M.go('pos', 'Shitje'); return [a, M.pageTable('P:Shitje').kpis.map(x => x.value)]; }, today0 = kp();
      pub(Tm, { ...JSON.parse(JSON.stringify(MR)), id: 'M:k2b3c4:2026-09', no: 'POS-BAR-2-202609-k2b3c4', date: '2026-09-20', terminal: TERM2 }); await M.ledgerTick(); await settle(M);
      eq([M._ledger.rows.has('M:k2b3c4:2026-09'), kp()], [true, today0], 'a month row dated today is not "today" (P:Arkat, P:Shitje KPIs)'); tomb(Tm, 'M:k2b3c4:2026-09'); await M.ledgerTick(); await settle(M);
      // every page, the month drawer and its payments render
      { const errs = []; for (const n of M.NAV) for (const pg of n.items) { Object.assign(M.state, { admin: false, section: n.id, page: pg, dr: null }); try { M.renderVals(); } catch (e) { errs.push(n.id + '/' + pg + ': ' + e.message); } }
        try { M.openDr('pos', md.id); M.drawerVals(); M.renderVals(); M.state.section = 'finance'; M.state.page = 'Pagesa'; const t = M.pageTable('Pagesa'); const rw = t.rows.find(x => JSON.stringify(x.cells).includes('POS-202608-k1a2b3K')); if (rw && rw.open) rw.open(); M.drawerVals(); M.renderVals(); if (!rw) errs.push('payment POS-202608-k1a2b3K not listed'); } catch (e) { errs.push('month drawer: ' + e.message); }
        Object.assign(M.state, { dr: null, drawer: null, section: 'dashboard', page: 'Paneli' }); eq(errs, [], 'month rows: every page, the month drawer and its payments render'); }
      eq([S.bad, S.noHdr], [[], []], 'mock server (month rows): no commit carried `_srv` rows or posSync runtime fields, every call had X-Kontabo-Client: 2');
      M.logout(); done(M);
    } finally { for (const x of made) { x.posListAuto = () => {}; x.posListAutoStop(); clearTimeout(x._plT); done(x); } delete ctx.document.visibilityState; S.rcHold = null; } // (a refresh still on its way re-arms nothing; no app timer outlives a test that threw)
  }).catch(e => { console.log('FAIL auto-refresh / month tests threw: ' + (e && e.stack || e)); process.exitCode = 1; });
