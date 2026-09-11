// Reminder engine tests: runs the real apps-script/Code.gs timer logic with a fake clock.
import assert from 'node:assert/strict';
import { makeBackend } from './mock-apps-script.mjs';

let count = 0;
const test = (name, fn) => { try { fn(); count++; console.log('✓ ' + name); } catch (e) { console.error('FAILED: ' + name); throw e; } };
// Toronto is UTC-4 in September 2026
const at = (date, hm) => Date.parse(`${date}T${hm}:00-04:00`);

function family(be, extra = []) {
  const token = be.post({ action: 'unlock', pin: '246810', api: 'https://script.google.com/macros/s/ABC_def-123/exec', app: 'https://chillychilly14.github.io/family-calendar/' }).token;
  const people = [
    { id: 'kevin', name: 'Kevin', color: '#2563eb', notify: { ntfy: 'fam-kevin-x1', follow: ['kevin', 'luke', 'max'], summary: true, summaryTime: '07:00' } },
    { id: 'kate', name: 'Kate', color: '#db2777', notify: { email: 'kate@example.com' } },
    { id: 'luke', name: 'Luke', color: '#16a34a' },
    { id: 'max', name: 'Max', color: '#ea580c' },
  ];
  const ops = [{ opId: 's', id: 'settings_family', type: 'settings', data: { id: 'settings_family', people, timezone: 'America/Toronto' } }, ...extra]
    .map((o, i) => ({ opId: o.opId || 'o' + i, ...o }));
  const res = be.post({ action: 'sync', token, since: 0, ops });
  assert.equal(res.accepted.length, ops.length);
  return token;
}

test('coffee machine checklist item fires at 9pm with a working ✓ Done button, then nags, then stops once done', () => {
  const be = makeBackend();
  family(be, [{ id: 'ro_coffee', type: 'routine', data: { id: 'ro_coffee', title: 'Set coffee machine', icon: '☕', time: '21:00', days: [], people: ['kevin'], nag: 15 } }]);
  be.props.LAST_CHECK = String(at('2026-09-11', '20:56'));
  let sent = be.run('checkReminders_', at('2026-09-11', '21:01'));
  assert.equal(sent.length, 1);
  const push = be.outbox.find(m => m.via === 'ntfy');
  assert.equal(push.topic, 'fam-kevin-x1');
  assert.match(push.title, /Set coffee machine/);
  const done = push.actions.find(a => a.label === '✓ Done');
  assert.equal(done.url, 'https://script.google.com/macros/s/ABC_def-123/exec');
  assert.equal(push.click, 'https://chillychilly14.github.io/family-calendar/');
  // nothing new 4 minutes later, then a nag at 9:15
  assert.equal(be.run('checkReminders_', at('2026-09-11', '21:05')).length, 0);
  sent = be.run('checkReminders_', at('2026-09-11', '21:16'));
  assert.equal(sent.length, 1); assert.match(sent[0].title, /still to do/);
  // tap Done on the phone → logged → no more nags
  const body = JSON.parse(done.body);
  assert.equal(be.post({ ...body, sig: 'nope' }).error, 'auth');
  assert.ok(be.post(body).ok);
  assert.equal(be.run('checkReminders_', at('2026-09-11', '21:31')).length, 0);
  // and it comes back tomorrow
  be.props.LAST_CHECK = String(at('2026-09-12', '20:58'));
  assert.equal(be.run('checkReminders_', at('2026-09-12', '21:02')).length, 1);
});

test('event reminders go to the people involved and anyone following them', () => {
  const be = makeBackend();
  family(be, [
    { id: 'ev_vb', type: 'event', data: { id: 'ev_vb', title: 'Volleyball', category: 'volleyball', people: ['luke'], date: '2026-09-08', start: '18:00', end: '19:30', repeat: { freq: 'weekly', days: [2, 4] }, remind: '60', bring: 'Knee pads', dropoff: 'kate' } },
    { id: 'ev_kate', type: 'event', data: { id: 'ev_kate', title: 'Dentist', people: ['kate'], date: '2026-09-11', start: '10:00', end: '10:30', remind: '30' } },
    { id: 'ev_none', type: 'event', data: { id: 'ev_none', title: 'No reminder', people: [], date: '2026-09-11', start: '10:00', end: '11:00', remind: '' } },
  ]);
  be.props.LAST_CHECK = String(at('2026-09-10', '16:57')); // Thursday
  const sent = be.run('checkReminders_', at('2026-09-10', '17:01'));
  assert.deepEqual(sent.map(s => s.id), ['ev_vb']);
  const msg = be.outbox.at(-1);
  assert.equal(msg.topic, 'fam-kevin-x1'); // Kevin follows Luke; Kate only follows herself
  assert.match(msg.title, /Volleyball in 1 hr/);
  assert.match(msg.message, /Knee pads/); assert.match(msg.message, /Drop-off: Kate/);
  be.outbox.length = 0;
  be.props.LAST_CHECK = String(at('2026-09-11', '09:26'));
  be.run('checkReminders_', at('2026-09-11', '09:31'));
  assert.deepEqual(be.outbox.map(m => m.via + ':' + (m.to || m.topic)), ['email:kate@example.com']);
});

test('day-before and morning-of reminders for all-day events; skipped dates stay quiet', () => {
  const be = makeBackend();
  family(be, [
    { id: 'ev_t', type: 'event', data: { id: 'ev_t', title: 'Tournament', people: ['max'], date: '2026-09-13', allDay: true, remind: '300' } },
    { id: 'ev_m', type: 'event', data: { id: 'ev_m', title: 'Picture day', people: ['luke'], date: '2026-09-14', allDay: true, remind: '-480', exdates: [] } },
    { id: 'ev_x', type: 'event', data: { id: 'ev_x', title: 'Skipped practice', people: ['luke'], date: '2026-09-07', start: '18:00', repeat: { freq: 'weekly', days: [1] }, exdates: ['2026-09-14'], remind: '60' } },
  ]);
  be.props.LAST_CHECK = String(at('2026-09-12', '18:58'));
  assert.deepEqual(be.run('checkReminders_', at('2026-09-12', '19:02')).map(s => s.id), ['ev_t']);
  be.props.LAST_CHECK = String(at('2026-09-14', '07:58'));
  assert.deepEqual(be.run('checkReminders_', at('2026-09-14', '08:03')).map(s => s.id), ['ev_m']);
  be.props.LAST_CHECK = String(at('2026-09-14', '16:58'));
  assert.equal(be.run('checkReminders_', at('2026-09-14', '17:03')).length, 0);
});

test('morning summary lists the day for followed people; long outages never flood', () => {
  const be = makeBackend();
  family(be, [
    { id: 'ev_s', type: 'event', data: { id: 'ev_s', title: 'School', people: ['luke', 'max'], date: '2026-09-07', start: '08:45', repeat: { freq: 'weekly', days: [1, 2, 3, 4, 5] }, remind: '' } },
    { id: 'mp_2026-09-11', type: 'mealplan', data: { id: 'mp_2026-09-11', date: '2026-09-11', recipeId: 'cn-honeygarlic', recipeName: 'Honey Garlic Chicken' } },
  ]);
  be.props.LAST_CHECK = String(at('2026-09-11', '06:57'));
  const sent = be.run('checkReminders_', at('2026-09-11', '07:02'));
  assert.deepEqual(sent.map(s => s.kind), ['summary']);
  const m = be.outbox.at(-1);
  assert.match(m.title, /Good morning, Kevin/); assert.match(m.message, /8:45am School/); assert.match(m.message, /Honey Garlic Chicken/);
  // 3 hours offline → only looks back 45 minutes
  be.props.LAST_CHECK = String(at('2026-09-11', '07:02'));
  assert.equal(be.run('checkReminders_', at('2026-09-11', '10:00')).length, 0);
});

test('email reminders carry a one-tap Done link that works from the inbox', () => {
  const be = makeBackend();
  const token = be.post({ action: 'unlock', pin: '246810', api: 'https://script.google.com/macros/s/ABC_def-123/exec', app: 'https://chillychilly14.github.io/family-calendar/' }).token;
  const people = [{ id: 'kevin', name: 'Kevin', notify: { email: 'kevin@example.com' } }];
  be.post({ action: 'sync', token, since: 0, ops: [
    { opId: 'a', id: 'settings_family', type: 'settings', data: { id: 'settings_family', people, timezone: 'America/Toronto' } },
    { opId: 'b', id: 'ro_coffee', type: 'routine', data: { id: 'ro_coffee', title: 'Set coffee machine', icon: '☕', time: '21:00', days: [], people: ['kevin'], nag: 0 } },
  ] });
  be.props.LAST_CHECK = String(at('2026-09-11', '20:57'));
  assert.equal(be.run('checkReminders_', at('2026-09-11', '21:02')).length, 1);
  const mail = be.outbox.find(m => m.via === 'email');
  assert.equal(mail.to, 'kevin@example.com');
  assert.match(mail.subject, /Set coffee machine/);
  const link = mail.body.match(/https:\/\/script\.google\.com\S+/)[0];
  assert.match(link, /\?done=ro_coffee&date=2026-09-11&sig=[a-f0-9]{24}/);
  const params = Object.fromEntries(new URL(link).searchParams);
  assert.match(be.get(params).html, /Done/);
  // the whole family sees it, and the nag stops
  const after = be.post({ action: 'sync', token, since: 0, ops: [] });
  assert.equal(after.items.find(i => i.type === 'routineLog').data.done, true);
  assert.match(be.get({ ...params, sig: 'bad' }).html, /not valid/);
});

test('setup installs exactly one timer; test button needs the PIN token', () => {
  const be = makeBackend();
  const token = family(be);
  be.run('setup'); be.run('setup');
  assert.equal(be.triggers.length, 1);
  assert.equal(be.post({ action: 'testNotify', token: 'x'.repeat(64), person: 'kevin' }).error, 'auth');
  const r = be.post({ action: 'testNotify', token, person: 'kevin' });
  assert.ok(r.ok && r.reminders);
  assert.equal(be.post({ action: 'testNotify', token, person: 'luke' }).error, 'no_channel');
});

console.log(`✓ ${count} reminder tests passed`);
