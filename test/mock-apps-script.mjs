// Runs the real apps-script/Code.gs inside Node with tiny stand-ins for Google's services,
// so the sync protocol can be tested end-to-end without deploying. Usage: node test/mock-apps-script.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export function makeBackend({ pin = '246810' } = {}) {
  const sheets = {};
  const makeSheet = (name) => {
    const rows = []; // 1-based rows as arrays
    const sh = {
      rows,
      getLastRow: () => rows.length,
      setFrozenRows() {}, setColumnWidth() {},
      getRange(r, c, nr = 1, nc = 1) {
        return {
          setValues(vals) { vals.forEach((row, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach((v, j) => { rows[r - 1 + i][c - 1 + j] = v; }); }); return this; },
          getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')); },
          setFontWeight() { return this; },
        };
      },
    };
    sheets[name] = sh; return sh;
  };
  const props = pin ? { FAMILY_PIN: pin } : {}; const cache = {};
  const outbox = []; const triggers = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => makeSheet(n) }), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(), sleep() {},
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value).digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
        return fmt === 'yyyy-MM-dd' ? `${parts.year}-${parts.month}-${parts.day}` : `${parts.hour}:${parts.minute}`;
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    Logger: { log() {} },
    console: { log() {} },
    UrlFetchApp: { fetch: (url, opts) => { outbox.push({ via: 'ntfy', url, ...JSON.parse(opts.payload) }); return { getResponseCode: () => 200 }; } },
    MailApp: { sendEmail: (m) => { outbox.push({ via: 'email', ...m }); } },
    Session: { getScriptTimeZone: () => 'America/Toronto' },
    ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1), newTrigger: fn => ({ timeBased: () => ({ everyMinutes: m => ({ create: () => triggers.push({ getHandlerFunction: () => fn, minutes: m }) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return {
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    get: () => JSON.parse(ctx.doGet().text),
    sheets, cache, props, outbox, triggers,
    run: (name, ...args) => JSON.parse(JSON.stringify(ctx[name](...args) ?? null)),
  };
}

if (process.argv[1] && process.argv[1].endsWith('mock-apps-script.mjs')) {
  const port = Number(process.argv[2] || 4174);
  const be = makeBackend();
  http.createServer((req, res) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method === 'GET') { res.writeHead(200, headers); res.end(JSON.stringify(be.get())); return; }
    let data = ''; req.on('data', c => data += c); req.on('end', () => {
      const out = be.post(JSON.parse(data || '{}'));
      setTimeout(() => { res.writeHead(200, headers); res.end(JSON.stringify(out)); }, 150);
    });
  }).listen(port, () => console.log('mock Apps Script on http://localhost:' + port + '/exec'));
}
