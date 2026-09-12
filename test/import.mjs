// Schedule / .ics import tests
import assert from 'node:assert/strict';
import { parseSchedule, parseIcs, findDate, findTimes } from '../import.js';

let count = 0;
const test = (name, fn) => { try { fn(); count++; console.log('✓ ' + name); } catch (e) { console.error('FAILED: ' + name); throw e; } };
const TODAY = '2026-09-11';

test('reads the date shapes leagues actually print', () => {
  assert.equal(findDate('Sat Sep 14 6:00 PM vs Ajax', TODAY), '2026-09-14');
  assert.equal(findDate('2026-10-03, 9:00', TODAY), '2026-10-03');
  assert.equal(findDate('10/03/2026 game', TODAY), '2026-10-03');
  assert.equal(findDate('September 14th, 2026', TODAY), '2026-09-14');
  assert.equal(findDate('14 Sept 2026', TODAY), '2026-09-14');
  assert.equal(findDate('9/14', TODAY), '2026-09-14');
  assert.equal(findDate('Jan 10', TODAY), '2027-01-10', 'a month already past means next year');
  assert.equal(findDate('practice as usual', TODAY), null);
});

test('reads times and time ranges, ignoring scores', () => {
  assert.deepEqual(findTimes('6:00 PM').start, '18:00');
  assert.equal(findTimes('6pm-7:30pm').end, '19:30');
  assert.equal(findTimes('18:00 to 19:30').end, '19:30');
  assert.equal(findTimes('7:15am').start, '07:15');
  assert.equal(findTimes('12:00 AM').start, '00:00');
  assert.equal(findTimes('no time here').start, '');
});

test('parses a pasted season and splits title from location', () => {
  const { events, skipped } = parseSchedule(`
Date      Time     Opponent           Location
Sat Sep 20 10:00 AM vs Ajax United @ Kinsmen Park Field 3
Sun Sep 28 1:30 PM - 3:00 PM at Whitby Wolves @ Iroquois Park
Oct 4 9:00 am vs Oshawa @ Kinsmen Park Field 1
team photos Oct 11
somebody's note with no date
`, { today: TODAY, defaultTitle: 'Soccer' });
  assert.equal(events.length, 4);
  assert.deepEqual(events[0], { date: '2026-09-20', start: '10:00', end: '11:30', allDay: false, title: 'Soccer Ajax United', location: 'Kinsmen Park Field 3', line: events[0].line, warn: events[0].warn });
  assert.equal(events[1].end, '15:00');
  assert.equal(events[1].title, 'Soccer Whitby Wolves');
  assert.equal(events[2].date, '2026-10-04');
  assert.equal(events[3].allDay, true, 'no time means an all-day entry');
  assert.equal(events[3].title, 'Soccer team photos');
  assert.deepEqual(skipped, ["somebody's note with no date"]);
});

test('flags a weekday that does not match the date', () => {
  const { events } = parseSchedule('Sat Sep 20 10:00 AM vs Ajax\nSun Sep 20 10:00 AM vs Ajax B', { today: TODAY });
  assert.match(events[0].warn, /says Sat, but 2026-09-20 is a Sunday/);
  assert.equal(events[1].warn, '', 'Sunday is right, so no warning');
});

test('drops duplicate lines and keeps its own title when no default is given', () => {
  const { events } = parseSchedule('Sep 20 10:00 AM Swim meet\nSep 20 10:00 AM Swim meet\nSep 21 4pm Dentist', { today: TODAY });
  assert.deepEqual(events.map(e => e.title), ['Swim meet', 'Dentist']);
});

test('parses a team .ics: times, all-day, repeats and skipped dates', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=America/Toronto:20260915T180000', 'DTEND;TZID=America/Toronto:20260915T193000',
    'SUMMARY:Volleyball practice', 'LOCATION:Community centre\\, gym 2',
    'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH;UNTIL=20261201T000000Z', 'EXDATE;TZID=America/Toronto:20261013T180000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261014', 'SUMMARY:Tournament', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:3', 'DTSTART:20260920T140000Z', 'SUMMARY:Long ti', ' tle folded', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const { events } = parseIcs(ics);
  assert.equal(events.length, 3);
  assert.deepEqual({ ...events[0], line: undefined }, { date: '2026-09-15', start: '18:00', end: '19:30', endDate: '', allDay: false, title: 'Volleyball practice', location: 'Community centre, gym 2', repeat: { freq: 'weekly', interval: 1, days: [2, 4], until: '2026-12-01' }, exdates: ['2026-10-13'], line: undefined });
  assert.equal(events[1].allDay, true);
  assert.equal(events[1].endDate, '2026-10-13', 'the exclusive end date becomes the last day');
  assert.equal(events[2].title, 'Long title folded');
  assert.ok(/^\d{2}:\d{2}$/.test(events[2].start), 'a UTC stamp becomes a local time');
});

console.log(`✓ ${count} import tests passed`);
