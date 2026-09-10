// Unit tests: recurrence, holidays, and the real Apps Script backend (via Node stand-ins).
import assert from 'node:assert/strict';
import * as L from './lib.js';
import { RECIPES, CUISINES, dailyPicks } from './meals.js';
import { makeBackend } from './test/mock-apps-script.mjs';

let n = 0; const t = (name, fn) => { fn(); n++; };

t('weekly repeat on chosen days with until + skipped date', () => {
  const ev = { id: 'a', date: '2026-09-08', repeat: { freq: 'weekly', days: [2, 4], until: '2026-10-01' }, exdates: ['2026-09-17'] };
  assert.deepEqual(L.occurrences(ev, '2026-09-01', '2026-09-30').map(o => o.date), ['2026-09-08', '2026-09-10', '2026-09-15', '2026-09-22', '2026-09-24', '2026-09-29']);
});
t('every 2 weeks stays on cadence years later', () => {
  assert.deepEqual(L.occurrences({ id: 'b', date: '2026-01-05', repeat: { freq: 'weekly', interval: 2 } }, '2026-09-01', '2026-09-30').map(o => o.date), ['2026-09-14', '2026-09-28']);
});
t('monthly on the 31st skips short months', () => {
  assert.deepEqual(L.occurrences({ id: 'c', date: '2020-01-31', repeat: { freq: 'monthly' } }, '2026-01-01', '2026-06-30').map(o => o.date), ['2026-01-31', '2026-03-31', '2026-05-31']);
});
t('yearly birthdays', () => {
  assert.deepEqual(L.occurrences({ id: 'd', date: '2015-05-20', repeat: { freq: 'yearly' } }, '2026-01-01', '2026-12-31').map(o => o.date), ['2026-05-20']);
});
t('multi-day event overlapping range start', () => {
  const o = L.occurrences({ id: 'e', date: '2026-08-30', endDate: '2026-09-02' }, '2026-09-01', '2026-09-30');
  assert.equal(o.length, 1); assert.equal(o[0].endDate, '2026-09-02');
});
t('Ontario holidays 2026', () => {
  const h = Object.fromEntries(L.holidays(2026).map(x => [x.name, x.date]));
  assert.equal(h['Family Day'], '2026-02-16'); assert.equal(h['Good Friday'], '2026-04-03'); assert.equal(h['Victoria Day'], '2026-05-18');
  assert.equal(h['Labour Day'], '2026-09-07'); assert.equal(h['Thanksgiving'], '2026-10-12');
});
t('overlap layout splits columns', () => {
  const out = L.layoutDay([{ s: 600, e: 660 }, { s: 630, e: 700 }, { s: 720, e: 780 }]);
  assert.equal(out.find(x => x.s === 600).cols, 2); assert.equal(out.find(x => x.s === 720).cols, 1);
});
t('recipes: every cuisine has at least 6, ids unique, all have steps', () => {
  for (const c of CUISINES) assert.ok(RECIPES.filter(r => r.cuisine === c.id).length >= 6, c.id);
  assert.equal(new Set(RECIPES.map(r => r.id)).size, RECIPES.length);
  RECIPES.forEach(r => { assert.ok(r.ingredients.length && r.steps.length && r.picky.length, r.id); });
  assert.equal(dailyPicks('2026-09-10').length, 5);
  assert.deepEqual(dailyPicks('2026-09-10').map(r => r.id), dailyPicks('2026-09-10').map(r => r.id));
});
t('backend: PIN required, token works, wrong PIN is throttled', () => {
  const be = makeBackend();
  assert.equal(be.post({ action: 'sync', token: 'x'.repeat(64), since: 0, ops: [] }).error, 'auth');
  const bad = be.post({ action: 'unlock', pin: '0000' });
  assert.equal(bad.error, 'wrong_pin');
  const ok = be.post({ action: 'unlock', pin: '2468' });
  assert.ok(ok.ok && ok.token.length === 64);
  for (let i = 0; i < 10; i++) be.post({ action: 'unlock', pin: '1111' });
  assert.equal(be.post({ action: 'unlock', pin: '2468' }).error, 'locked');
});
t('backend: two devices sync, updates and deletes propagate', () => {
  const be = makeBackend();
  const tok = be.post({ action: 'unlock', pin: '2468' }).token;
  const a = be.post({ action: 'sync', token: tok, since: 0, by: 'Kevin', ops: [{ id: 'ev_1', type: 'event', data: { id: 'ev_1', title: 'Soccer' } }] });
  assert.ok(a.ok && a.items.length === 1);
  const b = be.post({ action: 'sync', token: tok, since: 0, by: 'Kate', ops: [] });
  assert.equal(b.items[0].data.title, 'Soccer');
  const b2 = be.post({ action: 'sync', token: tok, since: b.now, by: 'Kate', ops: [{ id: 'ev_1', type: 'event', data: { id: 'ev_1', title: 'Soccer game' } }, { id: 'n_1', type: 'need', data: { id: 'n_1', text: 'Milk' } }] });
  const a2 = be.post({ action: 'sync', token: tok, since: a.now, ops: [] });
  assert.deepEqual(a2.items.map(i => i.id).sort(), ['ev_1', 'n_1']);
  assert.equal(a2.items.find(i => i.id === 'ev_1').data.title, 'Soccer game');
  const a3 = be.post({ action: 'sync', token: tok, since: a2.now, ops: [{ id: 'n_1', type: 'need', deleted: true }] });
  const b3 = be.post({ action: 'sync', token: tok, since: b2.now, ops: [] });
  assert.ok(b3.items.find(i => i.id === 'n_1').deleted);
  assert.equal(be.sheets.Items.rows.length, 3); // header + 2 items
  const inc = be.post({ action: 'sync', token: tok, since: a3.now + 1, ops: [] });
  assert.equal(inc.items.length, 0);
});
console.log(`✓ ${n} tests passed`);
