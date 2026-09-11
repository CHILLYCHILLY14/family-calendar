/**
 * Family Hub — shared storage backend (Google Apps Script + Google Sheets)
 * ------------------------------------------------------------------------
 * 1. In Project Settings → Script properties, add FAMILY_PIN (4–12 digits).
 * 2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * 3. Paste the Web app URL into config.js (API_URL) in your GitHub repo.
 *
 * The PIN lives only here (in your private Google account), never in GitHub.
 * Every request must carry a token that can only be obtained with the PIN.
 * All data is stored in the "Items" tab of the spreadsheet this script is attached to.
 *
 * REMINDERS (phone push via the free ntfy app, and/or email):
 * 4. After pasting a new version of this file: Save → pick "setup" in the function menu → Run
 *    (allow the new permissions). That starts a timer that checks reminders every few minutes.
 * 5. Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy (the URL stays the same).
 */

const SHEET_NAME = 'Items';
const MAX_FAILS = 8;                // wrong PIN attempts allowed ...
const LOCK_MINUTES = 15;            // ... before PIN entry is paused for everyone
const HEADERS = ['id', 'type', 'data', 'updatedAt', 'deleted', 'updatedBy'];
const CHECK_EVERY_MINUTES = 5;      // reminder timer: 1, 5, 10, 15 or 30

function doGet() {
  return json_({ ok: true, app: 'family-hub', version: 3, time: Date.now() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('bad_request');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  try {
    switch (body.action) {
      case 'unlock': return json_(unlock_(body));
      case 'sync':   return json_(sync_(body));
      case 'ping':   return json_({ ok: true, auth: validToken_(body.token), time: Date.now(), reminders: remindersRunning_() });
      case 'done':   return json_(doneFromNotification_(body));
      case 'testNotify': return json_(testNotify_(body));
      default:       return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server_error', message: String(err && err.message || err) });
  }
}

/* ---------- auth ---------- */

function familyPin_() {
  const pin = PropertiesService.getScriptProperties().getProperty('FAMILY_PIN') || '';
  return /^[0-9]{4,12}$/.test(pin) ? pin : '';
}

function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function tokenFor_(pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin) + '|' + secret_(), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function validToken_(token) {
  const pin = familyPin_();
  return !!pin && typeof token === 'string' && token.length === 64 && token === tokenFor_(pin);
}

function unlock_(body) {
  const pin = familyPin_();
  if (!pin) return { ok: false, error: 'not_configured', message: 'Add a 4–12 digit FAMILY_PIN in Google Apps Script project settings.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pin_fails') || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: 'locked', minutes: LOCK_MINUTES };
  if (String(body.pin || '') !== pin) {
    cache.put('pin_fails', String(fails + 1), LOCK_MINUTES * 60);
    Utilities.sleep(600);
    return { ok: false, error: 'wrong_pin', remaining: Math.max(0, MAX_FAILS - fails - 1) };
  }
  cache.remove('pin_fails');
  rememberUrls_(body);
  return { ok: true, token: tokenFor_(pin) };
  } finally { lock.releaseLock(); }
}

/* ---------- storage ---------- */

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 480);
  }
  return sh;
}

/**
 * One round trip: push pending changes, then pull everything changed since `since`.
 * body: { token, since, by, ops: [{ id, type, data, deleted }] }
 */
function sync_(body) {
  if (!validToken_(body.token)) return { ok: false, error: 'auth' };
  const ops = Array.isArray(body.ops) ? body.ops : [];
  const since = Number(body.since || 0);
  if (!Number.isFinite(since) || since < 0 || ops.length > 500) return { ok: false, error: 'bad_request' };
  const by = String(body.by || '').replace(/^[\s=+\-@]+/, '').slice(0, 40);
  rememberUrls_(body);

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
    const index = Object.create(null);
    let maxStamp = 0;
    rows.forEach((r, i) => { if (r[0]) { index[r[0]] = i; maxStamp = Math.max(maxStamp, Number(r[3]) || 0); } });

    // Monotonic clock: every write gets a stamp larger than anything already stored,
    // so devices asking "what changed since X?" never miss an edit.
    let now = Math.max(Date.now(), maxStamp);
    const full = since === 0 || since > now;
    const appended = [];
    const changed = {};
    const accepted = [];
    const rejected = [];
    ops.forEach(op => {
      const reject = reason => rejected.push({ opId: op && op.opId || '', reason });
      if (!op || typeof op.id !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/.test(op.id)) { reject('invalid_id'); return; }
      const type = String(op.type || '');
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,29}$/.test(type)) { reject('invalid_type'); return; }
      const deleted = !!op.deleted;
      if (!deleted && (!op.data || typeof op.data !== 'object' || Array.isArray(op.data) || op.data.id !== op.id)) { reject('invalid_data'); return; }
      const data = deleted ? '' : JSON.stringify(op.data || {});
      if (data.length > 45000) { reject('too_large'); return; }
      now += 1; // strictly increasing stamps inside one batch
      const row = [op.id, type, data, now, deleted, by];
      if (op.id in index) {
        rows[index[op.id]] = row;
        changed[index[op.id]] = true;
      } else {
        index[op.id] = rows.length;
        rows.push(row);
        appended.push(rows.length - 1);
      }
      if (typeof op.opId === 'string') accepted.push(op.opId);
    });

    // write back only what changed
    Object.keys(changed).forEach(i => {
      sh.getRange(Number(i) + 2, 1, 1, HEADERS.length).setValues([rows[i]]);
    });
    if (appended.length) {
      const first = appended[0];
      sh.getRange(first + 2, 1, appended.length, HEADERS.length).setValues(appended.map(i => rows[i]));
    }
    SpreadsheetApp.flush();

    const items = [];
    rows.forEach(r => {
      if (!r[0] || (!full && Number(r[3]) < since)) return;
      let data = null;
      if (!r[4] && r[2]) { try { data = JSON.parse(r[2]); } catch (err) { data = null; } }
      items.push({ id: r[0], type: r[1], data: data, updatedAt: Number(r[3]), deleted: !!r[4], by: r[5] });
    });
    return { ok: true, now: now, items: items, full: full, accepted: accepted, rejected: rejected, reminders: remindersRunning_() };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
   REMINDERS — a timer (see setup) sends phone push (ntfy) and/or email.
   ===================================================================== */

function hex_(bytes) { return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }

// short signature so a notification's "✓ Done" button can tick one checklist item without the PIN
function sign_(text) { return hex_(Utilities.computeHmacSha256Signature(text, secret_())).slice(0, 24); }

function rememberUrls_(body) {
  const props = PropertiesService.getScriptProperties();
  const api = String(body.api || ''), app = String(body.app || '');
  if (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(api) && props.getProperty('WEB_URL') !== api) props.setProperty('WEB_URL', api);
  if (/^https:\/\/[^\s]{4,200}$/.test(app) && props.getProperty('APP_URL') !== app) props.setProperty('APP_URL', app);
}

function remindersRunning_() {
  try { return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'checkReminders'); } catch (e) { return false; }
}

function loadData_() {
  const items = {};
  const sh = sheet_();
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
  rows.forEach(r => {
    if (!r[0] || r[4] || !r[2]) return;
    let d; try { d = JSON.parse(r[2]); } catch (e) { return; }
    (items[r[1]] = items[r[1]] || []).push(d);
  });
  return { items: items, settings: (items.settings || [])[0] || {} };
}

// zone-free date math on 'YYYY-MM-DD' strings (same rules as the app's lib.js)
const pad_ = n => ('0' + n).slice(-2);
const dayIdx_ = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const fromIdx_ = i => { const d = new Date(i * 86400000); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()); };
const addDays_ = (s, n) => fromIdx_(dayIdx_(s) + n);
const dow_ = s => new Date(dayIdx_(s) * 86400000).getUTCDay();
const toMin_ = t => { if (!t) return null; const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); };
function fmtTime_(t) { if (!t) return ''; const p = String(t).split(':').map(Number); return ((p[0] + 11) % 12 + 1) + (p[1] ? ':' + pad_(p[1]) : '') + (p[0] < 12 ? 'am' : 'pm'); }

function occurs_(ev, date) {
  if (!ev || !ev.date || date < ev.date) return false;
  if (ev.exdates && ev.exdates.indexOf(date) >= 0) return false;
  const r = ev.repeat || { freq: 'none' };
  if (r.until && date > r.until) return false;
  const n = Math.max(1, Number(r.interval) || 1);
  const diff = dayIdx_(date) - dayIdx_(ev.date);
  switch (r.freq) {
    case 'daily': return diff % n === 0;
    case 'weekly': {
      const days = (r.days && r.days.length ? r.days : [dow_(ev.date)]).map(Number);
      if (days.indexOf(dow_(date)) < 0) return false;
      const week = d => Math.floor((dayIdx_(d) - dow_(d)) / 7);
      return (week(date) - week(ev.date)) % n === 0;
    }
    case 'monthly': {
      if (+date.slice(8) !== +ev.date.slice(8)) return false;
      return ((+date.slice(0, 4) - +ev.date.slice(0, 4)) * 12 + (+date.slice(5, 7) - +ev.date.slice(5, 7))) % n === 0;
    }
    case 'yearly': return date.slice(5) === ev.date.slice(5) && (+date.slice(0, 4) - +ev.date.slice(0, 4)) % n === 0;
    default: return date === ev.date;
  }
}

function localNow_(tz, ms) {
  const d = new Date(ms);
  const date = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  const min = toMin_(Utilities.formatDate(d, tz, 'HH:mm'));
  return { date: date, min: min, abs: dayIdx_(date) * 1440 + min };
}

// who hears about something involving `ids` (empty = everyone): people who follow any of them
function recipients_(people, ids) {
  const involved = ids && ids.length ? ids : people.map(p => p.id);
  return people.filter(p => {
    const n = p.notify || {};
    if (!n.ntfy && !n.email) return false;
    const follow = n.follow && n.follow.length ? n.follow : [p.id];
    return follow.some(id => involved.indexOf(id) >= 0);
  });
}

function send_(settings, people, msg) {
  const server = String(settings.ntfyServer || 'https://ntfy.sh').replace(/\/$/, '');
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL') || '';
  const topics = {}, emails = {};
  people.forEach(p => {
    const n = p.notify || {};
    const topic = String(n.ntfy || '').trim();
    if (topic && !topics[topic]) {
      topics[topic] = true;
      const payload = { topic: topic, title: msg.title, message: msg.body, tags: msg.tags || [], priority: msg.priority || 4 };
      if (appUrl) payload.click = appUrl;
      payload.actions = (msg.actions || []).concat(appUrl ? [{ action: 'view', label: 'Open', url: appUrl }] : []).slice(0, 3);
      try { UrlFetchApp.fetch(server + '/', { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }); }
      catch (e) { console.log('ntfy failed: ' + e); }
    }
    const email = String(n.email || '').trim();
    if (email && !emails[email] && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      emails[email] = true;
      try { MailApp.sendEmail({ to: email, subject: msg.title, body: msg.body + (appUrl ? '\n\nOpen the family calendar: ' + appUrl : '') }); }
      catch (e) { console.log('email failed: ' + e); }
    }
  });
}

/** Timer entry point (created by setup). */
function checkReminders() { checkReminders_(Date.now()); }

function checkReminders_(nowMs) {
  const props = PropertiesService.getScriptProperties();
  const data = loadData_();
  const s = data.settings;
  const people = Array.isArray(s.people) ? s.people : [];
  const tz = s.timezone || Session.getScriptTimeZone() || 'America/Toronto';
  const now = localNow_(tz, nowMs);
  const lastMs = Number(props.getProperty('LAST_CHECK') || 0);
  props.setProperty('LAST_CHECK', String(nowMs));
  if (!people.some(p => p.notify && (p.notify.ntfy || p.notify.email))) return [];
  // due window (last check, now] — never looks back more than 45 minutes, so an outage can't cause a flood
  const lastAbs = lastMs ? Math.max(localNow_(tz, lastMs).abs, now.abs - 45) : now.abs - CHECK_EVERY_MINUTES;
  const due = abs => abs > lastAbs && abs <= now.abs;
  const sent = [];
  const webUrl = props.getProperty('WEB_URL') || '';
  const byId = {}; people.forEach(p => { byId[p.id] = p; });
  const names = ids => (ids && ids.length ? ids.map(id => byId[id] ? byId[id].name : '').filter(String).join(', ') : 'Everyone');

  // 1) event reminders (yesterday … +2 days so "day before" alerts work)
  (data.items.event || []).forEach(ev => {
    if (ev.remind === '' || ev.remind == null) return;
    const r = Number(ev.remind);
    if (!Number.isFinite(r)) return;
    for (let k = -1; k <= 2; k++) {
      const date = addDays_(now.date, k);
      if (!occurs_(ev, date)) continue;
      const rel = (ev.allDay || !ev.start) ? -r : toMin_(ev.start) - r;
      if (!due(dayIdx_(date) * 1440 + rel)) continue;
      const dayWord = date === now.date ? 'Today' : date === addDays_(now.date, 1) ? 'Tomorrow' : date;
      const lines = [names(ev.people) + ' · ' + dayWord + (ev.allDay || !ev.start ? '' : ' ' + fmtTime_(ev.start) + (ev.end ? '–' + fmtTime_(ev.end) : '')) + (ev.location ? ' · ' + ev.location : '')];
      if (ev.bring) lines.push('🎒 Bring: ' + ev.bring);
      if (ev.dropoff && byId[ev.dropoff]) lines.push('🚗 Drop-off: ' + byId[ev.dropoff].name);
      if (ev.pickup && byId[ev.pickup]) lines.push('🏁 Pick-up: ' + byId[ev.pickup].name);
      const soon = !ev.allDay && ev.start && r > 0 && r < 1440 ? ' in ' + (r >= 60 ? (r / 60) + ' hr' : r + ' min') : '';
      const msg = { title: '⏰ ' + (ev.title || 'Event') + soon, body: lines.join('\n'), tags: ['calendar'] };
      send_(s, recipients_(people, ev.people), msg);
      sent.push({ kind: 'event', id: ev.id, date: date, title: msg.title });
    }
  });

  // 2) daily checklist — at its time, then again every `nag` minutes (max 3) until someone taps Done
  const logs = {}; (data.items.routineLog || []).forEach(l => { if (l.done) logs[l.routineId + '@' + l.date] = true; });
  (data.items.routine || []).forEach(rt => {
    if (rt.active === false || rt.remind === false || !rt.time) return;
    const date = now.date;
    if (rt.days && rt.days.length && rt.days.indexOf(dow_(date)) < 0) return;
    if (logs[rt.id + '@' + date]) return;
    const base = dayIdx_(date) * 1440 + toMin_(rt.time);
    const nag = Number(rt.nag) || 0;
    const times = [base].concat(nag ? [base + nag, base + 2 * nag, base + 3 * nag] : []);
    const hit = times.findIndex(due);
    if (hit < 0) return;
    const actions = webUrl ? [{ action: 'http', label: '✓ Done', url: webUrl, method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'done', id: rt.id, date: date, sig: sign_(rt.id + '|' + date) }), clear: true }] : [];
    const msg = { title: (rt.icon || '✅') + ' ' + rt.title + (hit ? ' — still to do' : ''), body: fmtTime_(rt.time) + ' · ' + names(rt.people) + '\nTap ✓ Done when it\'s finished.', tags: ['white_check_mark'], priority: hit ? 4 : 3, actions: actions };
    send_(s, recipients_(people, rt.people), msg);
    sent.push({ kind: 'routine', id: rt.id, date: date, title: msg.title });
  });

  // 3) morning summary for each person who turned it on
  people.forEach(p => {
    const n = p.notify || {};
    if (!n.summary || !(n.ntfy || n.email)) return;
    if (!due(dayIdx_(now.date) * 1440 + (toMin_(n.summaryTime || '07:00') || 420))) return;
    const follow = n.follow && n.follow.length ? n.follow : [p.id];
    const todays = (data.items.event || []).filter(ev => occurs_(ev, now.date) && (!ev.people || !ev.people.length || ev.people.some(id => follow.indexOf(id) >= 0)))
      .sort((a, b) => (a.allDay || !a.start ? -1 : toMin_(a.start)) - (b.allDay || !b.start ? -1 : toMin_(b.start)));
    const lines = todays.map(ev => '• ' + (ev.allDay || !ev.start ? 'All day' : fmtTime_(ev.start)) + ' ' + ev.title + ' (' + names(ev.people) + ')');
    const rts = (data.items.routine || []).filter(rt => rt.active !== false && (!rt.days || !rt.days.length || rt.days.indexOf(dow_(now.date)) >= 0));
    if (rts.length) lines.push('', '✅ Checklist: ' + rts.map(rt => rt.title + ' ' + fmtTime_(rt.time)).join(' · '));
    const plan = (data.items.mealplan || []).filter(m => m.date === now.date)[0];
    if (plan && (plan.text || plan.recipeName)) lines.push('🍽️ Dinner: ' + (plan.text || plan.recipeName));
    const needs = (data.items.need || []).filter(x => !x.done);
    if (needs.length) lines.push('🛒 ' + needs.length + ' item' + (needs.length > 1 ? 's' : '') + ' on the lists' + (needs.some(x => x.urgent) ? ' (some needed soon)' : ''));
    send_(s, [p], { title: '☀️ Good morning, ' + p.name + '!', body: lines.length ? lines.join('\n') : 'Nothing on the calendar today — enjoy!', tags: ['sunny'], priority: 3 });
    sent.push({ kind: 'summary', id: p.id, date: now.date });
  });
  return sent;
}

// "✓ Done" tapped on a phone notification
function doneFromNotification_(body) {
  const id = String(body.id || ''), date = String(body.date || '');
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(id) || !/^\d{4}-\d\d-\d\d$/.test(date) || body.sig !== sign_(id + '|' + date)) return { ok: false, error: 'auth' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    const rows = last > 1 ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];
    let maxStamp = 0, at = -1;
    const logId = 'rl_' + id + '_' + date;
    rows.forEach((r, i) => { maxStamp = Math.max(maxStamp, Number(r[3]) || 0); if (r[0] === logId) at = i; });
    const stamp = Math.max(Date.now(), maxStamp) + 1;
    const row = [logId, 'routineLog', JSON.stringify({ id: logId, routineId: id, date: date, done: true, by: 'Phone', at: Date.now() }), stamp, false, 'notification'];
    sh.getRange((at >= 0 ? at : rows.length) + 2, 1, 1, HEADERS.length).setValues([row]);
    SpreadsheetApp.flush();
    return { ok: true };
  } finally { lock.releaseLock(); }
}

// Settings → "Send test" (needs the PIN token)
function testNotify_(body) {
  if (!validToken_(body.token)) return { ok: false, error: 'auth' };
  rememberUrls_(body);
  const s = loadData_().settings;
  const p = (s.people || []).filter(x => x.id === body.person);
  if (!p.length || !(p[0].notify && (p[0].notify.ntfy || p[0].notify.email))) return { ok: false, error: 'no_channel', message: 'Save a phone topic or email for this person first.' };
  send_(s, p, { title: '🔔 Family Hub test', body: 'Reminders are working for ' + p[0].name + '!', tags: ['bell'], priority: 3 });
  return { ok: true, reminders: remindersRunning_() };
}

/** Run once from the editor (and again after pasting a new version): creates the Items tab, authorizes, and starts the reminder timer. */
function setup() {
  if (!familyPin_()) throw new Error('Add FAMILY_PIN (4–12 digits) under Project Settings → Script properties first.');
  sheet_();
  secret_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkReminders').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(CHECK_EVERY_MINUTES).create();
  Logger.log('Ready. Reminders are checked every ' + CHECK_EVERY_MINUTES + ' minutes. Now Deploy → Manage deployments → Edit → New version.');
}
