// Dates, recurrence, holidays and shared constants.

export const DEFAULT_PEOPLE = [
  { id: 'kevin', name: 'Kevin', color: '#2563eb', emoji: '🧔' },
  { id: 'kate', name: 'Kate', color: '#db2777', emoji: '👩' },
  { id: 'luke', name: 'Luke', color: '#16a34a', emoji: '🧒' },
  { id: 'max', name: 'Max', color: '#ea580c', emoji: '👦' },
];

export const PALETTE = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#c026d3', '#64748b'];

export const CATEGORIES = [
  { id: 'volleyball', name: 'Volleyball', icon: '🏐', color: '#f59e0b', outdoor: false, bring: 'Knee pads, court shoes, water bottle' },
  { id: 'soccer', name: 'Soccer', icon: '⚽', color: '#22c55e', outdoor: true, bring: 'Cleats, shin pads, jersey, water bottle' },
  { id: 'baseball', name: 'Baseball', icon: '⚾', color: '#ef4444', outdoor: true, bring: 'Glove, bat, helmet, cap, water bottle, sunscreen' },
  { id: 'ballhockey', name: 'Ball Hockey', icon: '🏒', color: '#3b82f6', outdoor: true, bring: 'Stick, gloves, helmet, water bottle' },
  { id: 'school', name: 'School', icon: '🏫', color: '#8b5cf6', outdoor: false, bring: '' },
  { id: 'work', name: 'Work', icon: '💼', color: '#64748b', outdoor: false, bring: '' },
  { id: 'family', name: 'Family', icon: '🏡', color: '#ec4899', outdoor: false, bring: '' },
  { id: 'birthday', name: 'Birthday', icon: '🎂', color: '#f472b6', outdoor: false, bring: 'Gift, card' },
  { id: 'appointment', name: 'Appointment', icon: '🩺', color: '#14b8a6', outdoor: false, bring: '' },
  { id: 'social', name: 'Social / Party', icon: '🎉', color: '#a855f7', outdoor: false, bring: '' },
  { id: 'chores', name: 'Chores', icon: '🧹', color: '#84cc16', outdoor: false, bring: '' },
  { id: 'other', name: 'Other', icon: '📌', color: '#94a3b8', outdoor: false, bring: '' },
];
export const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

export const NEED_LISTS = [
  { id: 'groceries', name: 'Groceries', icon: '🛒' },
  { id: 'clothes', name: 'Clothes', icon: '👕' },
  { id: 'school', name: 'School', icon: '🎒' },
  { id: 'sports', name: 'Sports Gear', icon: '🏅' },
  { id: 'household', name: 'Household', icon: '🏠' },
  { id: 'other', name: 'Other', icon: '📦' },
];

export const THEMES = [
  { id: 'light', name: 'Light', swatch: ['#ffffff', '#2563eb'] },
  { id: 'dark', name: 'Dark', swatch: ['#0f172a', '#60a5fa'] },
  { id: 'maple', name: 'Maple', swatch: ['#fbf4ea', '#c2410c'] },
  { id: 'aurora', name: 'Aurora', swatch: ['#0b1026', '#34d399'] },
  { id: 'auto', name: 'Auto', swatch: ['#ffffff', '#0f172a'] },
];

/* ---------------- dates ---------------- */
export const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const addMonths = (s, n) => { const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth()))); return iso(d); };
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const dow = s => parse(s).getDay();
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const startOfWeek = (s, weekStart = 0) => addDays(s, -((dow(s) - weekStart + 7) % 7));
export const startOfMonth = s => s.slice(0, 8) + '01';
export const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

const fmtCache = {};
const fmt = (opts) => fmtCache[JSON.stringify(opts)] ||= new Intl.DateTimeFormat('en-CA', opts);
export const fmtDate = (s, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => fmt(opts).format(parse(s));
export const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}${m ? ':' + pad(m) : ''}${h < 12 ? 'am' : 'pm'}`;
};
export const fmtRange = (e) => e.allDay ? 'All day' : (e.start ? fmtTime(e.start) + (e.end ? '–' + fmtTime(e.end) : '') : '');
export const relDay = (s) => {
  const d = diffDays(today(), s);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return fmtDate(s, { weekday: 'long' });
  return fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric' });
};

/* ---------------- recurrence ---------------- */
// event: { date, endDate?, repeat: { freq: 'none'|'daily'|'weekly'|'monthly'|'yearly', interval, days:[0-6], until }, exdates: [] }
export function occurrences(ev, from, to) {
  const out = [];
  const span = ev.endDate && ev.endDate > ev.date ? diffDays(ev.date, ev.endDate) : 0;
  const r = ev.repeat || { freq: 'none' };
  const until = r.until && r.until < to ? r.until : to;
  const ex = new Set(ev.exdates || []);
  const push = (d) => {
    if (ex.has(d)) return;
    const end = span ? addDays(d, span) : d;
    if (end >= from && d <= to) out.push({ ev, date: d, endDate: end, key: ev.id + '@' + d });
  };
  const interval = Math.max(1, Number(r.interval) || 1);
  if (!r.freq || r.freq === 'none') { push(ev.date); return out; }
  const lower = addDays(from, -span);
  if (r.freq === 'daily') {
    let d = ev.date;
    if (d < lower) { const skip = Math.floor(diffDays(d, lower) / interval) * interval; d = addDays(d, skip); }
    for (let i = 0; d <= until && i < 1000; i++, d = addDays(d, interval)) if (d >= ev.date) push(d);
  } else if (r.freq === 'weekly') {
    const days = (r.days && r.days.length ? r.days : [dow(ev.date)]).map(Number);
    let wk = startOfWeek(ev.date, 0);
    if (wk < lower) { const weeks = Math.floor(diffDays(wk, startOfWeek(lower, 0)) / 7 / interval) * interval; wk = addDays(wk, weeks * 7); }
    for (let i = 0; wk <= until && i < 600; i++, wk = addDays(wk, 7 * interval)) {
      for (const dd of days.slice().sort()) { const d = addDays(wk, dd); if (d >= ev.date && d <= until) push(d); }
    }
  } else if (r.freq === 'monthly') {
    const base = parse(ev.date); const dom = base.getDate();
    let y = base.getFullYear(), m = base.getMonth();
    const lo = parse(lower);
    const monthsAhead = (lo.getFullYear() - y) * 12 + lo.getMonth() - m;
    if (monthsAhead > 1) { const k = Math.floor((monthsAhead - 1) / interval) * interval; m += k; y += Math.floor(m / 12); m %= 12; }
    for (let i = 0; i < 400; i++) {
      if (dom <= daysInMonth(y, m)) { const d = `${y}-${pad(m + 1)}-${pad(dom)}`; if (d > until) break; if (d >= ev.date) push(d); }
      else if (`${y}-${pad(m + 1)}-01` > until) break;
      m += interval; y += Math.floor(m / 12); m %= 12;
    }
  } else if (r.freq === 'yearly') {
    const [, mm, dd] = ev.date.split('-');
    const baseYear = Number(ev.date.slice(0, 4));
    const firstYear = baseYear + Math.max(0, Math.ceil((Number(lower.slice(0, 4)) - baseYear) / interval)) * interval;
    for (let y = firstYear; y <= Number(until.slice(0, 4)); y += interval) {
      const d = `${y}-${mm}-${dd}`;
      if (mm === '02' && dd === '29' && daysInMonth(y, 1) < 29) continue;
      if (d >= ev.date && d <= until) push(d);
    }
  }
  return out;
}

export function describeRepeat(r) {
  if (!r || !r.freq || r.freq === 'none') return '';
  const n = Number(r.interval) || 1;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let s = { daily: n > 1 ? `Every ${n} days` : 'Daily', weekly: n > 1 ? `Every ${n} weeks` : 'Weekly', monthly: n > 1 ? `Every ${n} months` : 'Monthly', yearly: n > 1 ? `Every ${n} years` : 'Yearly' }[r.freq];
  if (r.freq === 'weekly' && r.days && r.days.length) s += ' on ' + r.days.slice().sort().map(d => names[d]).join(', ');
  if (r.until) s += ' until ' + fmtDate(r.until, { month: 'short', day: 'numeric', year: 'numeric' });
  return s;
}

/* ---------------- Ontario / Canada holidays ---------------- */
function nthWeekday(y, m, weekday, n) { // n: 1..5, or -1 for last
  if (n > 0) { const first = new Date(y, m, 1).getDay(); return iso(new Date(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)); }
  const last = new Date(y, m + 1, 0); return iso(new Date(y, m, last.getDate() - ((last.getDay() - weekday + 7) % 7)));
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(y, month - 1, day));
}
const holidayCache = {};
export function holidays(y) {
  if (holidayCache[y]) return holidayCache[y];
  const victoria = (() => { const d = new Date(y, 4, 24); return iso(new Date(y, 4, 24 - ((d.getDay() + 6) % 7))); })();
  const list = [
    [`${y}-01-01`, "New Year's Day", '🎆'],
    [nthWeekday(y, 1, 1, 3), 'Family Day', '👨‍👩‍👦'],
    [`${y}-02-14`, "Valentine's Day", '❤️'],
    [`${y}-03-17`, "St. Patrick's Day", '☘️'],
    [addDays(easter(y), -2), 'Good Friday', '🐣'],
    [easter(y), 'Easter Sunday', '🐰'],
    [addDays(easter(y), 1), 'Easter Monday', '🐣'],
    [nthWeekday(y, 4, 0, 2), "Mother's Day", '💐'],
    [victoria, 'Victoria Day', '👑'],
    [nthWeekday(y, 5, 0, 3), "Father's Day", '👔'],
    [`${y}-07-01`, 'Canada Day', '🇨🇦'],
    [nthWeekday(y, 7, 1, 1), 'Civic Holiday', '☀️'],
    [nthWeekday(y, 8, 1, 1), 'Labour Day', '🛠️'],
    [`${y}-09-30`, 'Truth & Reconciliation Day', '🧡'],
    [nthWeekday(y, 9, 1, 2), 'Thanksgiving', '🦃'],
    [`${y}-10-31`, 'Halloween', '🎃'],
    [`${y}-11-11`, 'Remembrance Day', '🌺'],
    [`${y}-12-24`, 'Christmas Eve', '🎄'],
    [`${y}-12-25`, 'Christmas Day', '🎄'],
    [`${y}-12-26`, 'Boxing Day', '🎁'],
    [`${y}-12-31`, "New Year's Eve", '🥳'],
  ];
  return (holidayCache[y] = list.map(([date, name, icon]) => ({ date, name, icon })));
}
export function holidaysBetween(from, to) {
  const out = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) for (const h of holidays(y)) if (h.date >= from && h.date <= to) out.push(h);
  return out;
}

/* ---------------- misc ---------------- */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// contrast-aware text colour for a background hex
export function ink(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111827' : '#ffffff';
}

// Weather codes (WMO) → emoji + label
export function weatherInfo(code) {
  const map = [[0, '☀️', 'Clear'], [1, '🌤️', 'Mostly clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [45, '🌫️', 'Fog'], [48, '🌫️', 'Fog'],
    [51, '🌦️', 'Drizzle'], [53, '🌦️', 'Drizzle'], [55, '🌦️', 'Drizzle'], [56, '🌧️', 'Freezing drizzle'], [57, '🌧️', 'Freezing drizzle'],
    [61, '🌧️', 'Light rain'], [63, '🌧️', 'Rain'], [65, '🌧️', 'Heavy rain'], [66, '🌧️', 'Freezing rain'], [67, '🌧️', 'Freezing rain'],
    [71, '🌨️', 'Light snow'], [73, '🌨️', 'Snow'], [75, '❄️', 'Heavy snow'], [77, '🌨️', 'Snow grains'], [80, '🌦️', 'Showers'], [81, '🌧️', 'Showers'], [82, '⛈️', 'Heavy showers'],
    [85, '🌨️', 'Snow showers'], [86, '❄️', 'Snow showers'], [95, '⛈️', 'Thunderstorm'], [96, '⛈️', 'Thunderstorm'], [99, '⛈️', 'Thunderstorm']];
  const m = map.find(x => x[0] === code) || [0, '🌡️', ''];
  return { icon: m[1], label: m[2] };
}

// Lay out overlapping timed events into columns: returns [{item, col, cols}]
export function layoutDay(items) {
  const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e);
  const out = []; let cluster = []; let clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex(end => end <= it.s);
      if (c === -1) { c = cols.length; cols.push(it.e); } else cols[c] = it.e;
      it.col = c;
    }
    cluster.forEach(it => out.push({ ...it, cols: cols.length }));
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return out;
}

// RFC 5545 export, using floating local times just like the calendar UI.
export function calendarFile(ev, description = '') {
  const date = value => value.replace(/-/g, '');
  const time = value => value.replace(':', '') + '00';
  const text = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, char => '\\' + char);
  const allDay = ev.allDay || !ev.start;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Hub//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${text(ev.id)}@family-hub`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`];
  if (allDay) lines.push(`DTSTART;VALUE=DATE:${date(ev.date)}`, `DTEND;VALUE=DATE:${date(addDays(ev.endDate || ev.date, 1))}`);
  else {
    const endMinutes = ev.end ? toMin(ev.end) : toMin(ev.start) + 60;
    const endDate = endMinutes >= 1440 ? addDays(ev.date, 1) : ev.date;
    lines.push(`DTSTART:${date(ev.date)}T${time(ev.start)}`, `DTEND:${date(endDate)}T${time(ev.end || fromMin(endMinutes))}`);
  }
  const repeat = ev.repeat;
  if (repeat?.freq && repeat.freq !== 'none') {
    let rule = `RRULE:FREQ=${repeat.freq.toUpperCase()};INTERVAL=${repeat.interval || 1};WKST=SU`;
    if (repeat.freq === 'weekly' && repeat.days?.length) rule += ';BYDAY=' + repeat.days.map(day => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][day]).join(',');
    if (repeat.until) rule += ';UNTIL=' + date(repeat.until) + (allDay ? '' : 'T235959');
    lines.push(rule);
    if (ev.exdates?.length) lines.push((allDay ? 'EXDATE;VALUE=DATE:' : 'EXDATE:') + [...new Set(ev.exdates)].sort().map(day => date(day) + (allDay ? '' : 'T' + time(ev.start))).join(','));
  }
  lines.push(`SUMMARY:${text(catById(ev.category).icon + ' ' + ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${text(ev.location)}`);
  if (description) lines.push(`DESCRIPTION:${text(description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  // Fold at 75 UTF-8 octets, without splitting accented letters or emoji.
  const encoder = new TextEncoder();
  return lines.map(line => {
    const parts = []; let part = ''; let bytes = 0;
    for (const char of line) {
      const size = encoder.encode(char).length;
      if (bytes + size > 75) { parts.push(part); part = ' '; bytes = 1; }
      part += char; bytes += size;
    }
    parts.push(part); return parts.join('\r\n');
  }).join('\r\n') + '\r\n';
}
