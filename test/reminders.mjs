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

test('the calendar feed needs its key, shows events only, and can be rotated', () => {
  const be = makeBackend();
  const token = family(be, [
    { id: 'ev_vb', type: 'event', data: { id: 'ev_vb', title: 'Volleyball; practice', category: 'volleyball', people: ['luke'], date: '2026-09-15', start: '18:00', end: '19:30', location: 'Gym 2', bring: 'Knee pads', repeat: { freq: 'weekly', interval: 1, days: [2, 4], until: '2026-12-01' }, exdates: ['2026-10-13'], remind: '60' } },
    { id: 'ev_trip', type: 'event', data: { id: 'ev_trip', title: 'Tournament', people: ['max'], date: '2026-10-12', endDate: '2026-10-13', allDay: true } },
    { id: 'n_secret', type: 'need', data: { id: 'n_secret', text: 'Anniversary present', list: 'other' } },
    { id: 'note_1', type: 'note', data: { id: 'note_1', text: 'private note' } },
  ]);
  const link = be.post({ action: 'feedLink', token, api: 'https://script.google.com/macros/s/ABC_def-123/exec' });
  assert.ok(link.ok && /^[a-f0-9]{32}$/.test(link.key));
  assert.equal(link.url, 'https://script.google.com/macros/s/ABC_def-123/exec?feed=' + link.key);
  assert.equal(be.post({ action: 'feedLink', token: 'x'.repeat(64) }).error, 'auth');

  const ics = be.get({ feed: link.key }).text.replace(/\r\n /g, '');
  assert.match(ics, /BEGIN:VCALENDAR[\s\S]+END:VCALENDAR/);
  assert.match(ics, /SUMMARY:Volleyball\\; practice/);
  assert.match(ics, /DTSTART;TZID=America\/Toronto:20260915T180000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;WKST=SU;BYDAY=TU,TH;UNTIL=20261201T235959/);
  assert.match(ics, /EXDATE;TZID=America\/Toronto:20261013T180000/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /DTEND;VALUE=DATE:20261014/, 'all-day end date is exclusive again on the way out');
  assert.ok(!/Anniversary present|private note/.test(ics), 'lists and notes never leave the app');

  assert.match(be.get({ feed: link.key, who: 'luke' }).text, /Volleyball/);
  assert.ok(!/Tournament/.test(be.get({ feed: link.key, who: 'luke' }).text), 'a personal feed only carries that person');
  assert.equal(be.get({ feed: 'guessed-key' }).text, 'Not found');
  const rotated = be.post({ action: 'feedLink', token, regenerate: true });
  assert.ok(rotated.ok && /^[a-f0-9]{32}$/.test(rotated.key) && rotated.key !== link.key);
  assert.equal(be.get({ feed: link.key }).text, 'Not found', 'the old link dies immediately');
});

test('week-ahead digest goes out on the chosen evening with driving and dinners', () => {
  const be = makeBackend();
  const token = be.post({ action: 'unlock', pin: '246810' }).token;
  const people = [{ id: 'kevin', name: 'Kevin', notify: { email: 'kevin@example.com', follow: ['kevin', 'luke'], weekly: true, weeklyDay: 0, weeklyTime: '18:00' } }, { id: 'luke', name: 'Luke' }, { id: 'kate', name: 'Kate' }];
  be.post({ action: 'sync', token, since: 0, ops: [
    { opId: 'a', id: 'settings_family', type: 'settings', data: { id: 'settings_family', people, timezone: 'America/Toronto' } },
    { opId: 'b', id: 'ev_s', type: 'event', data: { id: 'ev_s', title: 'Soccer game', people: ['luke'], date: '2026-09-19', start: '10:00', end: '11:00', location: 'Kinsmen', dropoff: 'kate', pickup: 'kevin' } },
    { opId: 'c', id: 'mp_2026-09-15', type: 'mealplan', data: { id: 'mp_2026-09-15', date: '2026-09-15', recipeName: 'Honey Garlic Chicken' } },
    { opId: 'd', id: 'n1', type: 'need', data: { id: 'n1', text: 'Milk', done: false } },
  ] });
  be.props.LAST_CHECK = String(at('2026-09-13', '17:56'));   // Sunday
  const sent = be.run('checkReminders_', at('2026-09-13', '18:02'));
  assert.deepEqual(sent.map(s => s.kind), ['weekly']);
  const last = be.outbox.at(-1);
  const body = last.body || last.message;
  assert.match(body, /Saturday 09-19/);
  assert.match(body, /10am Soccer game \(Luke\) @ Kinsmen — drop-off Kate, pick-up Kevin/);
  assert.match(body, /🍽️ Honey Garlic Chicken/);
  assert.match(body, /🚗 Driving: Kate ×1 · Kevin ×1/);
  assert.match(body, /1 item on the lists/);
  // not on other days, and not twice on the same evening
  be.props.LAST_CHECK = String(at('2026-09-14', '17:56'));
  assert.equal(be.run('checkReminders_', at('2026-09-14', '18:02')).length, 0);
});

test('weekly backup writes to Drive and keeps the last eight; cleanup drops only stale rows', () => {
  const be = makeBackend();
  const token = family(be, [{ id: 'ev_keep', type: 'event', data: { id: 'ev_keep', title: 'Keep me', date: '2026-09-20' } }]);
  for (let i = 0; i < 10; i++) be.run('weeklyBackup');
  const folder = be.folders['Family Hub Backups'];
  assert.equal(folder.files.filter(f => !f.trashed).length, 8);
  assert.match(folder.files.at(-1).content, /"title": "Keep me"/);
  assert.ok(be.post({ action: 'backupNow', token }).ok);
  assert.equal(be.post({ action: 'backupNow', token: 'x'.repeat(64) }).error, 'auth');

  // a fresh checklist tick, an ancient one, and an old tombstone
  const old = '2026-01-01', recent = '2026-09-11';
  be.post({ action: 'sync', token, since: 0, ops: [
    { opId: 'x', id: 'rl_ro_coffee_' + old, type: 'routineLog', data: { id: 'rl_ro_coffee_' + old, routineId: 'ro_coffee', date: old, done: true } },
    { opId: 'y', id: 'rl_ro_coffee_' + recent, type: 'routineLog', data: { id: 'rl_ro_coffee_' + recent, routineId: 'ro_coffee', date: recent, done: true } },
    { opId: 'z', id: 'ev_gone', type: 'event', data: { id: 'ev_gone', title: 'Deleted long ago', date: '2026-02-02' } },
  ] });
  be.post({ action: 'sync', token, since: 0, ops: [{ opId: 'z2', id: 'ev_gone', type: 'event', deleted: true }] });
  be.sheets.Items.rows.forEach(r => { if (r[0] === 'ev_gone') r[3] = Date.now() - 90 * 86400000; }); // aged tombstone
  const before = be.sheets.Items.rows.length;
  const res = be.run('monthlyCleanup');
  assert.equal(res.removed, 2, 'the ancient tick and the aged tombstone');
  assert.equal(be.sheets.Items.rows.length, before - 2);
  const left = be.post({ action: 'sync', token, since: 0, ops: [] }).items.map(i => i.id);
  assert.ok(left.includes('ev_keep') && left.includes('rl_ro_coffee_' + recent));
  assert.ok(!left.includes('ev_gone') && !left.includes('rl_ro_coffee_' + old));
});

test('setup installs one timer of each kind, even when run twice; test button needs the PIN token', () => {
  const be = makeBackend();
  const token = family(be);
  be.run('setup'); be.run('setup');
  assert.deepEqual(be.triggers.map(t => t.getHandlerFunction()).sort(), ['checkReminders', 'monthlyCleanup', 'weeklyBackup']);
  assert.equal(be.post({ action: 'testNotify', token: 'x'.repeat(64), person: 'kevin' }).error, 'auth');
  const r = be.post({ action: 'testNotify', token, person: 'kevin' });
  assert.ok(r.ok && r.reminders);
  assert.equal(be.post({ action: 'testNotify', token, person: 'luke' }).error, 'no_channel');
});

console.log(`✓ ${count} reminder tests passed`);
