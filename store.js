// Shared data store: optimistic local cache + background sync with the Apps Script backend.
import CONFIG from './config.js';

const K = {
  state: 'fh.state.v2',
  items: 'fh.items.v1',
  pending: 'fh.pending.v1',
  since: 'fh.since.v1',
  token: 'fh.token.v1',
  apiUrl: 'fh.apiUrl.v1',
  lastSync: 'fh.lastSync.v1',
};

const ls = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

export function uid(prefix = 'x') {
  const rand = (crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(36).padStart(2, '0')).join('') : Math.random().toString(36).slice(2));
  return `${prefix}_${Date.now().toString(36)}${rand}`.slice(0, 40);
}

export class Store {
  constructor() {
    const saved = ls.get(K.state, null);
    this.items = new Map(Object.entries(saved?.items || ls.get(K.items, {}) || {}));
    this.pending = saved?.pending || ls.get(K.pending, []) || [];
    this.since = saved?.since ?? ls.get(K.since, 0);
    this.token = ls.get(K.token, '');
    this.lastSync = ls.get(K.lastSync, 0);
    this.listeners = new Set();
    this.status = 'idle'; // idle | syncing | offline | error | auth | local
    this.statusMessage = '';
    this.timer = null;
    this.inflight = null;
    this.by = '';
    this.fetchImpl = (...a) => fetch(...a);
    this.session = 0;
    this.storageError = false;
    this.previewUnlocked = ls.get('fh.previewUnlocked', false);
  }

  get apiUrl() { return (ls.get(K.apiUrl, '') || CONFIG.API_URL || '').trim(); }
  set apiUrl(url) {
    const value = (url || '').trim();
    if (value === this.apiUrl) return;
    this.lock();
    if (!ls.set(K.apiUrl, value)) throw new Error('Browser storage is unavailable. Open the app in its own browser tab and try again.');
    this.since = 0;
    this.persist();
  }
  get isShared() { return !!this.apiUrl; }
  get isUnlocked() { return this.isShared ? !!this.token : this.previewUnlocked; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { this.listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } }); }
  setStatus(status, message = '') {
    if (this.status === status && this.statusMessage === message) return;
    this.status = status; this.statusMessage = message; this.emit('status');
  }

  persist() {
    // One atomic write: items, pending changes, and sync cursor stay together.
    const failed = !ls.set(K.state, { items: Object.fromEntries(this.items), pending: this.pending, since: this.since });
    if (failed !== this.storageError) { this.storageError = failed; this.emit('storage'); }
  }

  /* ---------- reads ---------- */
  list(type) {
    const out = [];
    for (const it of this.items.values()) if (it.type === type && !it.deleted && it.data) out.push(it.data);
    return out;
  }
  get(id) { const it = this.items.get(id); return it && !it.deleted ? it.data : null; }
  meta(id) { return this.items.get(id) || null; }

  /* ---------- writes (optimistic) ---------- */
  put(type, data) {
    if (!data.id) data.id = uid(type.slice(0, 2));
    const now = Date.now();
    const item = { id: data.id, type, data: { ...data }, updatedAt: now, deleted: false, by: this.by, local: true };
    this.items.set(data.id, item);
    this.queue({ id: data.id, type, data: item.data, deleted: false });
    return item.data;
  }
  remove(id) {
    const it = this.items.get(id);
    if (!it) return null;
    const prev = it.data;
    this.items.set(id, { ...it, deleted: true, data: null, updatedAt: Date.now(), local: true });
    this.queue({ id, type: it.type, deleted: true });
    return prev;
  }
  queue(op) {
    op.opId = uid('op');
    this.pending = this.pending.filter(p => p.id !== op.id); // newest change per item wins
    this.pending.push(op);
    this.persist();
    this.emit('data');
    this.scheduleSync(600);
  }

  /* ---------- auth ---------- */
  async unlock(pin) {
    if (!this.isShared) {
      const expected = String(ls.get('fh.previewPin', CONFIG.PREVIEW_PIN || '1234'));
      if (String(pin) === expected) {
        this.previewUnlocked = true;
        if (!ls.set('fh.previewUnlocked', true)) { this.storageError = true; this.emit('storage'); }
        this.setStatus('local'); return { ok: true };
      }
      return { ok: false, error: 'wrong_pin' };
    }
    const session = this.session;
    const res = await this.call({ action: 'unlock', pin: String(pin) });
    if (session !== this.session) return { ok: false, error: 'cancelled' };
    if (res.ok && typeof res.token === 'string' && /^[a-f0-9]{64}$/.test(res.token)) {
      this.token = res.token; ls.set(K.token, res.token);
      this.sync(true);
    } else if (res.ok) return { ok: false, error: 'bad_response' };
    return res;
  }
  lock() {
    this.session++;
    this.previewUnlocked = false;
    this.token = ''; ls.del(K.token); ls.set('fh.previewUnlocked', false);
    clearTimeout(this.timer);
    this.emit('lock');
  }
  setPreviewPin(pin) { ls.set('fh.previewPin', String(pin)); }

  /* ---------- network ---------- */
  async call(payload, timeoutMs = 30000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // "simple" request → no CORS preflight
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, error: 'http_' + res.status };
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' && typeof data.ok === 'boolean' ? data : { ok: false, error: 'bad_response' };
      } catch { return { ok: false, error: 'bad_response', message: 'The server did not return a valid response. Check the saved server link.' }; }
    } catch (err) {
      return { ok: false, error: navigator.onLine === false ? 'offline' : 'network', message: String(err && err.message || err) };
    } finally { clearTimeout(t); }
  }

  scheduleSync(ms) {
    if (!this.isShared || !this.token) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), ms);
  }

  async sync(force = false) {
    if (!this.isShared) { this.setStatus('local'); return; }
    if (!this.token) { this.setStatus('auth'); return; }
    if (this.inflight) { if (force) this.again = true; return this.inflight; }
    this.inflight = this._sync().finally(() => {
      this.inflight = null;
      if (this.again || this.pending.length && this.status === 'idle') { this.again = false; this.scheduleSync(300); }
      else this.scheduleSync((CONFIG.SYNC_SECONDS || 25) * 1000 * (document.hidden ? 4 : 1));
    });
    return this.inflight;
  }

  async _sync() {
    const session = this.session;
    this.setStatus('syncing');
    const sent = this.pending.slice(0, 200);
    const res = await this.call({ action: 'sync', token: this.token, since: this.since, by: this.by, ops: sent });
    if (session !== this.session) return; // Ignore a response from before locking/changing servers.
    if (!res.ok) {
      if (res.error === 'auth') { this.lock(); this.setStatus('auth', 'PIN changed — please unlock again'); return; }
      this.setStatus(res.error === 'offline' ? 'offline' : 'error', res.message || res.error);
      this.scheduleSync(15000);
      return;
    }
    if (!Array.isArray(res.items) || !Number.isFinite(res.now) || res.now < 0 || res.items.some(it => !it || typeof it.id !== 'string' || typeof it.type !== 'string' || !Number.isFinite(it.updatedAt))) {
      this.setStatus('error', 'Invalid sync response — your changes are still saved on this device.');
      return;
    }
    // New servers acknowledge each operation. Older servers must return the exact change.
    const acknowledged = Array.isArray(res.accepted) ? new Set(res.accepted) : null;
    const sentIds = new Set(sent.filter(op => acknowledged ? acknowledged.has(op.opId) : res.items.some(it => it.id === op.id && (op.deleted ? it.deleted : !it.deleted && JSON.stringify(it.data) === JSON.stringify(op.data)))).map(op => op.opId));
    this.pending = this.pending.filter(o => !sentIds.has(o.opId));
    const stillPending = new Set(this.pending.map(o => o.id));
    let changed = false;
    if (res.full) {
      // full snapshot: drop anything the server no longer has (except unsent local work)
      const serverIds = new Set(res.items.map(i => i.id));
      for (const id of [...this.items.keys()]) if (!serverIds.has(id) && !stillPending.has(id)) { this.items.delete(id); changed = true; }
    }
    for (const it of res.items) {
      if (stillPending.has(it.id)) continue; // our newer local edit wins until it's sent
      const cur = this.items.get(it.id);
      if (!cur || cur.updatedAt !== it.updatedAt || cur.local || cur.deleted !== it.deleted) {
        this.items.set(it.id, { id: it.id, type: it.type, data: it.data, updatedAt: it.updatedAt, deleted: it.deleted, by: it.by });
        if (!cur || JSON.stringify(cur.data) !== JSON.stringify(it.data) || cur.deleted !== it.deleted) changed = true;
      }
    }
    this.since = res.now;
    this.lastSync = Date.now(); ls.set(K.lastSync, this.lastSync);
    this.persist();
    const rejected = sent.some(op => !sentIds.has(op.opId));
    this.setStatus(rejected ? 'error' : 'idle', rejected ? 'Some changes were not accepted by the server. They remain on this device; export a backup before editing them.' : '');
    if (changed) this.emit('remote');
  }

  /* ---------- backup ---------- */
  exportAll() {
    return { app: 'family-hub', exportedAt: new Date().toISOString(), items: [...this.items.values()].filter(i => !i.deleted).map(({ id, type, data }) => ({ id, type, data })) };
  }
  importAll(json) {
    if (!json || !Array.isArray(json.items)) throw new Error('Not a Family Hub backup file');
    let n = 0;
    for (const it of json.items) { if (it && it.id && it.type && it.data) { this.put(it.type, { ...it.data, id: it.id }); n++; } }
    return n;
  }
  resetLocal() {
    this.session++;
    [K.state, K.items, K.pending, K.since, K.lastSync].forEach(k => ls.del(k));
    this.items = new Map(); this.pending = []; this.since = 0;
    this.emit('data');
  }
}

export const store = new Store();
export { ls };
