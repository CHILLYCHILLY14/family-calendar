import assert from 'node:assert/strict';
import { readLedger, saveLedger, calculateTrip, csvCell, parseCsv, importExpenses } from '../ledger/data.js';
import { makeBackend } from './mock-apps-script.mjs';

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('✓ ' + name); };
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
globalThis.document = { hidden: false };
const { Store } = await import('../store.js');
function device() {
  storage.clear();
  const hub = new Store(); hub.scheduleSync = () => {}; hub.token = 'a'.repeat(64);
  return hub;
}
const expense = (id, patch = {}) => ({ id, date: '2026-09-15', teamId: 'sl_team_luke', category: 'Registration', desc: 'Test registration', amount: 125.25, paidBy: 'Kevin', status: 'Paid', notes: '', ...patch });
function add(hub, row) { const before = readLedger(hub), after = structuredClone(before); after.expenses.push(row); return saveLedger(hub, before, after); }

await test('starter teams agree across fresh devices without writing on read', () => {
  const a = device(), b = device();
  assert.deepEqual(readLedger(a), readLedger(b));
  assert.equal(a.pending.length, 0);
  assert.equal(readLedger(a).expenses.length, 0);
});
await test('budget rows use the shared queue, survive reload, and leave calendar data intact', () => {
  const hub = device(); hub.put('event', { id: 'ev_existing', title: 'Soccer' });
  add(hub, expense('sl_exp_one'));
  assert.equal(hub.pending.filter(op => op.type === 'ledgerExpense').length, 1);
  assert.equal(hub.get('ev_existing').title, 'Soccer');
  const restored = new Store(); restored.scheduleSync = () => {};
  assert.equal(readLedger(restored).expenses[0].amount, 125.25);
  assert.ok(restored.exportAll().items.some(row => row.type === 'ledgerExpense'));
});
await test('saving a stale editor preserves a remote addition and other changed fields', () => {
  const hub = device(); add(hub, expense('sl_exp_one'));
  const before = readLedger(hub), editing = structuredClone(before);
  hub.put('ledgerExpense', { ...hub.get('sl_exp_one'), notes: 'Other device note' });
  hub.put('ledgerExpense', expense('sl_exp_two', { amount: 20 }));
  editing.expenses[0].desc = 'Edited details';
  const result = saveLedger(hub, before, editing);
  assert.equal(result.expenses.length, 2);
  assert.equal(hub.get('sl_exp_one').notes, 'Other device note');
  assert.equal(hub.get('sl_exp_one').desc, 'Edited details');
});
await test('deletions persist and a stale editor cannot revive an expense or starter team', () => {
  const hub = device(); add(hub, expense('sl_exp_one'));
  const before = readLedger(hub), editing = structuredClone(before);
  hub.remove('sl_exp_one'); editing.expenses[0].amount = 500;
  saveLedger(hub, before, editing);
  assert.equal(readLedger(hub).expenses.length, 0);
  const next = readLedger(hub), removed = structuredClone(next); removed.teams[0].deleted = true;
  saveLedger(hub, next, removed);
  assert.equal(readLedger(hub).teams.length, 1);
});
await test('deleting a virtual starter row creates a real tombstone on the first save', () => {
  const hub = device(), before = readLedger(hub), after = structuredClone(before);
  after.kids[0].deleted = true; saveLedger(hub, before, after);
  assert.equal(hub.meta('sl_kid_luke').deleted, true);
  assert.equal(readLedger(hub).kids.length, 1);
});
await test('locking blocks new ledger writes', () => {
  const hub = device(), before = readLedger(hub), after = structuredClone(before);
  after.expenses.push(expense('sl_exp_one')); hub.token = '';
  assert.throws(() => saveLedger(hub, before, after), /Unlock Family Hub/);
  assert.equal(hub.pending.length, 0);
});
await test('two devices exchange budget rows through the unchanged Apps Script protocol', async () => {
  const backend = makeBackend();
  const token = backend.post({ action: 'unlock', pin: '246810' }).token;
  const a = device(), b = device();
  for (const hub of [a, b]) {
    hub.token = token;
    hub.fetchImpl = async (_, opts) => new Response(JSON.stringify(backend.post(JSON.parse(opts.body))), { status: 200 });
  }
  add(a, expense('sl_exp_shared'));
  await a.sync(true); await b.sync(true);
  assert.equal(a.pending.length, 0);
  assert.equal(readLedger(b).expenses[0].amount, 125.25);
  const before = readLedger(b), after = structuredClone(before); after.expenses[0].status = 'Reimbursed';
  saveLedger(b, before, after); await b.sync(true); await a.sync(true);
  assert.equal(readLedger(a).expenses[0].status, 'Reimbursed');
});
await test('travel estimate rounds category costs and includes the return drive', () => {
  assert.deepEqual(calculateTrip({ km: 240, trips: 1, price: 1.55, consumption: 10.5, nights: 2, rate: 189, extra: 120 }), { gas: 78.12, hotel: 378, extra: 120, total: 576.12, km: 480 });
  assert.equal(calculateTrip({ km: 100, trips: 2, price: 1.5, consumption: 10, nights: 1, rate: 100, extra: 20 }).total, 300);
  for (const invalid of [{ km: -1 }, { trips: 1.5 }, { nights: NaN }, { price: Infinity }]) assert.throws(() => calculateTrip(invalid));
});
await test('CSV preserves quotes and multiline notes and neutralizes spreadsheet formulas', () => {
  const rows = [['date', 'details', 'amount', 'notes'], ['2026-09-15', 'Hotel, "Kingston"', '50.25', 'Line 1\nLine 2']];
  assert.deepEqual(parseCsv('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')), rows);
  assert.equal(csvCell('=HYPERLINK("https://example.com")')[1], "'");
  assert.equal(csvCell('-5.25'), '-5.25');
  assert.throws(() => parseCsv('"unfinished'), /unfinished/);
});
await test('CSV import adds rows without losing notes, and keeps unassigned expenses unassigned', () => {
  const hub = device(), original = readLedger(hub); let next = 0;
  const csv = 'date,kid,team,category,details,amount,paid by,status,notes\n2026-09-15,Luke,Volleyball,Hotel,Trip,125.50,Kate,Due,Keep receipt\n2026-09-16,,,Other,General,5,Kevin,Paid,';
  const result = importExpenses(original, csv, () => 'sl_csv_' + ++next, '2026-09-15');
  assert.equal(result.count, 2); assert.equal(original.expenses.length, 0);
  assert.equal(result.state.expenses[0].notes, 'Keep receipt');
  assert.equal(result.state.expenses[1].teamId, '');
  assert.equal(result.state.teams.length, 2);
});
await test('malformed CSV imports reject the complete batch before any saves', () => {
  const state = readLedger(device());
  for (const csv of ['amount,details\n20,Fee', 'date,amount,details\n2026-02-30,20,Fee', 'date,amount,details\n2026-09-15,NaN,Fee', 'date,amount,details\n2026-09-15,20,Good\n2026-09-16,1.2.3,Bad']) assert.throws(() => importExpenses(state, csv, () => 'sl_test', '2026-09-15'));
  assert.equal(state.expenses.length, 0);
});
console.log(`✓ ${passed} ledger tests passed`);
