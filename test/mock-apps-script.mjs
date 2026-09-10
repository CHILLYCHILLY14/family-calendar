// Runs the real apps-script/Code.gs inside Node with tiny stand-ins for Google's services,
// so the sync protocol can be tested end-to-end without deploying. Usage: node test/mock-apps-script.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export function makeBackend() {
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
  const props = {}; const cache = {};
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => makeSheet(n) }), flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(), sleep() {},
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    Logger: { log() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return {
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    get: () => JSON.parse(ctx.doGet().text),
    sheets, cache,
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
