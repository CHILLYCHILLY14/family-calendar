import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as L from '../lib.js';
import { makeBackend } from './mock-apps-script.mjs';

let count = 0;
async function test(name, fn) {
  try { await fn(); count++; console.log('✓ ' + name); }
  catch (error) { console.error('FAILED: ' + name); throw error; }
}

await test('yearly recurrence keeps its interval when viewed years later', () => {
  const event = { id: 'ev', date: '2020-05-20', repeat: { freq: 'yearly', interval: 3 } };
  assert.deepEqual(L.occurrences(event, '2024-01-01', '2031-12-31').map(o => o.date), ['2026-05-20', '2029-05-20']);
  assert.equal(L.describeRepeat(event.repeat), 'Every 3 years');
  assert.deepEqual(L.occurrences({ ...event, date: '2020-02-29', repeat: { freq: 'yearly', interval: 2 } }, '2021-01-01', '2028-12-31').map(o => o.date), ['2024-02-29', '2028-02-29']);
});
await test('calendar export preserves skipped dates, week start, and date-only until', () => {
  const event = { id: 'ev', date: '2026-09-11', endDate: '2026-09-13', allDay: true, title: 'Trip', repeat: { freq: 'weekly', interval: 2, until: '2026-10-30' }, exdates: ['2026-09-25'] };
  const file = L.calendarFile(event).replace(/\r\n /g, '');
  assert.ok(file.includes('DTEND;VALUE=DATE:20260914'));
  assert.ok(file.includes(';WKST=SU;UNTIL=20261030\r\n'));
  assert.ok(file.includes('EXDATE;VALUE=DATE:20260925'));
  const timed = L.calendarFile({ ...event, allDay: false, start: '18:00', end: '19:00' }).replace(/\r\n /g, '');
  assert.ok(timed.includes('EXDATE:20260925T180000'));
});
await test('calendar export folds UTF-8 safely and handles midnight', () => {
  const file = L.calendarFile({ id: 'ev', date: '2026-09-11', title: '🏐é'.repeat(50), start: '23:30' }, 'Note\rInjected;line,here');
  assert.ok(file.includes('DTEND:20260912T003000'));
  file.split('\r\n').forEach(line => assert.ok(Buffer.byteLength(line) <= 75));
  assert.ok(file.replace(/\r\n /g, '').includes('Note\\nInjected\\;line\\,here'));
});
await test('backend has no usable default family PIN', () => {
  const backend = makeBackend({ pin: '' });
  assert.equal(backend.post({ action: 'unlock', pin: '2468' }).error, 'not_configured');
  assert.equal(backend.post(null).error, 'bad_request');
});
await test('four-digit family PINs work without accepting shorter or overlong PINs', () => {
  const backend = makeBackend({ pin: '1357' });
  const result = backend.post({ action: 'unlock', pin: '1357' });
  assert.ok(result.ok && result.token.length === 64);
  assert.ok(backend.post({ action: 'sync', token: result.token, since: 0, ops: [] }).ok);
  for (const pin of ['123', '1234567890123']) {
    assert.equal(makeBackend({ pin }).post({ action: 'unlock', pin }).error, 'not_configured');
  }
});
await test('changing the private PIN invalidates existing tokens', () => {
  const backend = makeBackend();
  const token = backend.post({ action: 'unlock', pin: '246810' }).token;
  backend.props.FAMILY_PIN = '654321';
  assert.equal(backend.post({ action: 'sync', token, ops: [] }).error, 'auth');
  assert.ok(backend.post({ action: 'unlock', pin: '654321' }).ok);
});
await test('backend acknowledges valid writes and rejects unsafe or oversized rows', () => {
  const backend = makeBackend();
  const token = backend.post({ action: 'unlock', pin: '246810' }).token;
  const result = backend.post({ action: 'sync', token, since: 0, ops: [
    { opId: 'good', id: '__proto__', type: 'note', data: { id: '__proto__', text: 'Safe map key' } },
    { opId: 'formula', id: '=IMPORTXML', type: 'note', data: { id: '=IMPORTXML' } },
    { opId: 'large', id: 'large', type: 'note', data: { id: 'large', text: 'x'.repeat(45001) } },
    { opId: 'wrong', id: 'wrong', type: 'note', data: { id: 'different' } },
  ] });
  assert.deepEqual(result.accepted, ['good']);
  assert.equal(result.rejected.length, 3);
  assert.equal(result.items.length, 1);
  assert.equal(backend.sheets.Items.rows.length, 2);
});

const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'document', { value: { hidden: false }, configurable: true });
const { Store } = await import('../store.js');
function device() {
  values.clear();
  const store = new Store();
  store.scheduleSync = ms => { store.nextSync = ms; };
  store.apiUrl = 'https://script.google.com/macros/s/test/exec';
  store.token = 'a'.repeat(64);
  return store;
}
function connect(store, backend) {
  store.token = backend.post({ action: 'unlock', pin: '246810' }).token;
  store.fetchImpl = async (_, options) => new Response(JSON.stringify(backend.post(JSON.parse(options.body))));
}
await test('local snapshot restores data and unsent changes together', () => {
  const store = device();
  store.put('need', { id: 'n1', text: 'Milk' });
  const restored = new Store();
  assert.equal(restored.get('n1').text, 'Milk');
  assert.equal(restored.pending.length, 1);
});
await test('storage failure preserves the last durable snapshot and reports failure', () => {
  const store = device();
  store.put('need', { id: 'n1', text: 'Milk' });
  const before = values.get('fh.state.v2');
  storage.setItem = () => { throw new Error('QuotaExceeded'); };
  store.put('need', { id: 'n1', text: 'Bread' });
  assert.equal(store.storageError, true);
  assert.equal(values.get('fh.state.v2'), before);
  assert.equal(store.exportAll().items[0].data.text, 'Bread');
  storage.setItem = (key, value) => values.set(key, String(value));
  store.persist();
  assert.equal(store.storageError, false);
});
await test('newer edits survive a response to an older edit', async () => {
  const store = device(), backend = makeBackend();
  connect(store, backend);
  let finish;
  store.fetchImpl = (_, options) => new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify(backend.post(JSON.parse(options.body))))); });
  store.put('need', { id: 'n1', text: 'Milk' });
  const syncing = store.sync();
  store.put('need', { id: 'n1', text: 'Bread' });
  finish(); await syncing;
  assert.equal(store.get('n1').text, 'Bread');
  assert.equal(store.pending.length, 1);
  assert.equal(store.nextSync, 300);
  connect(store, backend); await store.sync();
  assert.equal(store.pending.length, 0);
  assert.equal(backend.sheets.Items.rows[1][2], JSON.stringify({ id: 'n1', text: 'Bread' }));
});
await test('rejected writes remain in the queue and full snapshots retain them', async () => {
  const store = device(), backend = makeBackend(); connect(store, backend);
  store.put('note', { id: 'n1', text: 'x'.repeat(45001) });
  await store.sync();
  assert.equal(store.pending.length, 1);
  assert.ok(store.get('n1'));
  assert.equal(store.status, 'error');
});
await test('invalid JSON and malformed sync payloads never discard local edits', async () => {
  const store = device(); store.put('need', { id: 'n1', text: 'Milk' });
  for (const payload of ['null', '<html>Sign in</html>', '{"ok":true,"now":1}', '{"ok":true,"now":2,"items":[null]}']) {
    store.fetchImpl = async () => new Response(payload);
    await store.sync();
    assert.equal(store.pending.length, 1);
    assert.equal(store.status, 'error');
  }
});
await test('locking during a request prevents stale responses from changing local data', async () => {
  const store = device(); store.put('need', { id: 'n1', text: 'Milk' });
  let finish;
  store.fetchImpl = () => new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({ ok: true, now: 2, full: true, items: [], accepted: store.pending.map(op => op.opId) }))); });
  const syncing = store.sync(); store.lock(); finish(); await syncing;
  assert.equal(store.pending.length, 1); assert.equal(store.get('n1').text, 'Milk'); assert.equal(store.token, '');
});
await test('large queues continue promptly beyond the first 200 items', async () => {
  const store = device(), backend = makeBackend(); connect(store, backend);
  for (let i = 0; i < 205; i++) store.put('need', { id: 'n' + i, text: 'Item ' + i });
  await store.sync();
  assert.equal(store.pending.length, 5); assert.equal(store.nextSync, 300);
  await store.sync(); assert.equal(store.pending.length, 0);
});
await test('legacy server responses only acknowledge matching changes', async () => {
  const store = device(); store.put('need', { id: 'n1', text: 'Milk' });
  store.fetchImpl = async () => new Response(JSON.stringify({ ok: true, now: 2, full: true, items: [{ id: 'n1', type: 'need', data: { id: 'n1', text: 'Old' }, updatedAt: 1, deleted: false }] }));
  await store.sync(); assert.equal(store.pending.length, 1); assert.equal(store.get('n1').text, 'Milk');
});

function workerHarness() {
  const handlers = {}, deleted = [], stored = new Map(); let activated = false;
  const cache = { addAll: async () => {}, put: async (request, value) => stored.set(request.url, value), match: async request => stored.get(typeof request === 'string' ? request : request.url) };
  const context = {
    URL, Response,
    self: { location: { href: 'https://example.com/family-calendar/sw.js' }, addEventListener: (name, fn) => handlers[name] = fn, skipWaiting: async () => { activated = true; }, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['family-hub-v1', 'family-hub-v2', 'family-hub-v3', 'family-hub-v4', 'mlb-edge-v1'], delete: async key => deleted.push(key) },
    fetch: async () => { throw new Error('Offline'); },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return { handlers, deleted, stored, cache, context, activated: () => activated };
}
await test('offline cache activation leaves other GitHub Pages apps alone', async () => {
  const worker = workerHarness(); let done;
  worker.handlers.activate({ waitUntil: promise => done = promise }); await done;
  assert.deepEqual(worker.deleted, ['family-hub-v1', 'family-hub-v2', 'family-hub-v3']);
});
await test('worker ignores other project paths and only returns HTML for navigation', async () => {
  const worker = workerHarness(); let response;
  worker.stored.set('https://example.com/family-calendar/index.html', new Response('app'));
  worker.handlers.fetch({ request: { url: 'https://example.com/mlb-edge/app.js', method: 'GET' }, respondWith: () => { throw new Error('Intercepted another app'); } });
  worker.handlers.fetch({ request: { url: 'https://example.com/family-calendar/missing.js', method: 'GET', mode: 'cors' }, respondWith: value => response = value });
  assert.equal((await response).type, 'error');
  worker.handlers.fetch({ request: { url: 'https://example.com/family-calendar/', method: 'GET', mode: 'navigate' }, respondWith: value => response = value });
  assert.equal(await (await response).text(), 'app');
});
await test('failed offline install does not activate an incomplete replacement', async () => {
  const worker = workerHarness(); let done;
  worker.cache.addAll = async () => { throw new Error('Missing asset'); };
  worker.handlers.install({ waitUntil: promise => done = promise });
  await assert.rejects(done); assert.equal(worker.activated(), false);
});
await test('editing one repeated multi-day event keeps its selected dates', () => {
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function saveEvent() {'), source.indexOf('\nasync function deleteEvent()'));
  const writes = [], messages = [];
  const series = { id: 'ev', title: 'Trip', date: '2026-09-11', endDate: '2026-09-13', allDay: true, repeat: { freq: 'monthly' }, exdates: [] };
  const context = { L, structuredClone, draft: { ev: series, onlyThis: true, isNew: false, occDate: '2026-10-11', onlyDate: '2026-10-12', onlyEndDate: '2026-10-14' }, me: () => null, store: { get: () => series, put: (_, data) => writes.push(data) }, toast: value => messages.push(value), closeModal() {}, renderPage() {} };
  vm.runInNewContext(fn + '\nsaveEvent();', context);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].exdates[0], '2026-10-11');
  assert.equal(writes[1].date, '2026-10-12');
  assert.equal(writes[1].endDate, '2026-10-14');
  context.draft.onlyEndDate = '2026-10-10'; writes.length = 0;
  vm.runInNewContext(fn + '\nsaveEvent();', context);
  assert.equal(writes.length, 0); assert.match(messages.at(-1), /end date/);
});
console.log(`✓ ${count} regression tests passed`);
