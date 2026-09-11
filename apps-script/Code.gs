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
 */

const SHEET_NAME = 'Items';
const MAX_FAILS = 8;                // wrong PIN attempts allowed ...
const LOCK_MINUTES = 15;            // ... before PIN entry is paused for everyone
const HEADERS = ['id', 'type', 'data', 'updatedAt', 'deleted', 'updatedBy'];

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
      case 'ping':   return json_({ ok: true, auth: validToken_(body.token), time: Date.now() });
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
    return { ok: true, now: now, items: items, full: full, accepted: accepted, rejected: rejected };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Optional: run once from the editor to create the Items tab and authorize the script. */
function setup() {
  if (!familyPin_()) throw new Error('Add FAMILY_PIN (4–12 digits) under Project Settings → Script properties first.');
  sheet_();
  secret_();
  Logger.log('Ready. Now Deploy → New deployment → Web app.');
}
