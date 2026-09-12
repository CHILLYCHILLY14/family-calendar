// Turning a pasted schedule or a team .ics file into Family Hub events.
import * as L from './lib.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

// "6:30 pm" / "6pm" / "18:30" → "18:30"
function toTime(h, m, ap) {
  let hh = Number(h);
  const mm = Number(m || 0);
  if (ap) { const p = ap.toLowerCase()[0]; if (p === 'p' && hh < 12) hh += 12; if (p === 'a' && hh === 12) hh = 0; }
  if (hh > 23 || mm > 59) return null;
  return `${pad(hh)}:${pad(mm)}`;
}

/** Pull a date out of a line. Returns 'YYYY-MM-DD' or null. Dates with no year roll forward, never back. */
export function findDate(text, today = L.today()) {
  const thisYear = Number(today.slice(0, 4));
  let m;
  if ((m = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b/))) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${year}-${pad(m[1])}-${pad(m[2])}`;                       // North American M/D/Y
  }
  if ((m = text.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?\\b`, 'i')))) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const year = m[3] ? Number(m[3]) : thisYear;
    const iso = `${year}-${pad(month)}-${pad(m[2])}`;
    return !m[3] && iso < today ? `${year + 1}-${pad(month)}-${pad(m[2])}` : iso;
  }
  if ((m = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})[a-z]*\\.?(?:,?\\s*(20\\d{2}))?\\b`, 'i')))) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    const year = m[3] ? Number(m[3]) : thisYear;
    const iso = `${year}-${pad(month)}-${pad(m[1])}`;
    return !m[3] && iso < today ? `${year + 1}-${pad(month)}-${pad(m[1])}` : iso;
  }
  if ((m = text.match(/\b(\d{1,2})\/(\d{1,2})\b/))) {                  // 9/14 — assume this season
    const iso = `${thisYear}-${pad(m[1])}-${pad(m[2])}`;
    return iso < today ? `${thisYear + 1}-${pad(m[1])}-${pad(m[2])}` : iso;
  }
  return null;
}

/** Pull start (and optional end) times out of a line. */
export function findTimes(text) {
  const one = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const found = [];
  let m;
  while ((m = one.exec(text))) {
    const t = m[4] != null ? toTime(m[4], m[5]) : toTime(m[1], m[2], m[3]);
    if (t) found.push({ t, at: m.index, raw: m[0] });
    if (found.length === 2) break;
  }
  if (!found.length) return { start: '', end: '', used: [] };
  const between = found.length === 2 ? text.slice(found[0].at + found[0].raw.length, found[1].at) : '';
  const isRange = /^\s*(-|–|—|to|until|till)\s*$/i.test(between);
  return { start: found[0].t, end: isRange ? found[1].t : '', used: found.slice(0, isRange ? 2 : 1) };
}

const NOISE = /^(vs\.?|v\.?|at|home|away|game|match)$/i;
function cleanTitle(text) {
  const s = text.replace(/\s{2,}/g, ' ').replace(/^[\s,;|\-–—]+|[\s,;|\-–—]+$/g, '');
  const words = s.split(' ').filter(Boolean);
  while (words.length > 1 && NOISE.test(words[0])) words.shift();
  return words.join(' ').trim();
}

/**
 * Parse a pasted schedule — one event per line.
 * Returns { events: [{ date, start, end, allDay, title, location, line }], skipped: [lines] }
 */
export function parseSchedule(text, { today = L.today(), defaultTitle = '' } = {}) {
  const events = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(date|day)\b.*\b(time|opponent|event|location)\b/i.test(line)) continue; // header row
    const date = findDate(line, today);
    if (!date) { if (line.length > 2) skipped.push(line); continue; }
    const { start, end, used } = findTimes(line);
    let rest = line;
    used.forEach(u => { rest = rest.replace(u.raw, ' '); });
    rest = rest
      .replace(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?`, 'i'), ' ')
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*20\d{2})?/i, ' ')
      .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/, ' ')
      .replace(/\b\d{1,2}[-/]\d{1,2}(?:[-/](?:20)?\d{2})?\b/, ' ')
      .replace(/\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\b/i, ' ');
    // "vs Ajax @ Kinsmen Field" / "at Whitby Wolves @ Iroquois Park" — the LAST separator marks the place
    let title = rest, location = '';
    const sep = [...rest.matchAll(/\s+@\s+/g)].pop() || [...rest.matchAll(/\s+\bat\b\s+/gi)].pop();
    if (sep) {
      title = rest.slice(0, sep.index);
      location = cleanTitle(rest.slice(sep.index + sep[0].length));
    }
    title = cleanTitle(title);
    if (defaultTitle) title = title && !title.toLowerCase().includes(defaultTitle.toLowerCase()) ? `${defaultTitle} ${title}` : (title || defaultTitle);
    title = title || 'Event';
    const key = `${date}|${start}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // if the line names a weekday that doesn't match the date, say so — usually a wrong year or a typo
    const named = line.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i);
    const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const wantedDay = named ? NAMES.findIndex(d => named[1].toLowerCase().startsWith(d)) : -1;
    const warn = wantedDay >= 0 && wantedDay !== L.dow(date)
      ? `the line says ${named[1]}, but ${date} is a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][L.dow(date)]}`
      : '';
    events.push({
      date, start,
      end: end || (start ? L.fromMin(Math.min(1439, L.toMin(start) + 90)) : ''),
      allDay: !start, title, location, line, warn,
    });
  }
  return { events, skipped };
}

/* ---------------- .ics files (TeamSnap, SportsEngine, school boards) ---------------- */
const unescapeIcs = s => String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function icsDate(value, params = '') {
  const v = String(value).trim();
  const dateOnly = /VALUE=DATE(?!-TIME)/i.test(params) || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (dateOnly || !m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  if (m[7]) {                                                   // UTC → this device's local time
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return { date: L.iso(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` }; // floating or TZID: keep as written
}

function icsRepeat(rule) {
  const parts = Object.fromEntries(String(rule).split(';').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = String(parts.FREQ || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const days = (parts.BYDAY || '').split(',').map(d => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.replace(/^[-+]?\d+/, '').toUpperCase())).filter(i => i >= 0);
  const until = parts.UNTIL ? (icsDate(parts.UNTIL) || {}).date || '' : '';
  return { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1), days, until };
}

/** Parse an .ics file into the same shape as parseSchedule. */
export function parseIcs(text) {
  const unfolded = String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  const skipped = [];
  for (const block of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const body = block.split(/END:VEVENT/i)[0];
    const field = name => {
      const m = body.match(new RegExp(`^${name}([^:\\n]*):(.*)$`, 'im'));
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    const start = field('DTSTART');
    if (!start) continue;
    const s = icsDate(start.value, start.params);
    if (!s) { skipped.push(body.trim().slice(0, 60)); continue; }
    const endField = field('DTEND');
    const e = endField ? icsDate(endField.value, endField.params) : null;
    const rrule = field('RRULE');
    const summary = field('SUMMARY');
    const location = field('LOCATION');
    const exdates = (body.match(/^EXDATE[^:\n]*:(.*)$/gim) || [])
      .flatMap(line => line.split(':')[1].split(',').map(v => (icsDate(v.trim()) || {}).date).filter(Boolean));
    const allDay = !s.time;
    events.push({
      date: s.date,
      start: s.time,
      end: e && e.time ? e.time : (s.time ? L.fromMin(Math.min(1439, L.toMin(s.time) + 90)) : ''),
      endDate: allDay && e && e.date > s.date ? L.addDays(e.date, -1) : '',   // all-day DTEND is exclusive
      allDay,
      title: summary ? unescapeIcs(summary.value) : 'Event',
      location: location ? unescapeIcs(location.value) : '',
      repeat: rrule ? icsRepeat(rrule.value) : null,
      exdates,
    });
  }
  return { events, skipped };
}
