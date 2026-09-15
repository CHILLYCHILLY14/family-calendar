// Season Ledger uses Family Hub's existing authenticated, per-record sync queue.
export const TYPES = { kids: 'ledgerKid', teams: 'ledgerTeam', expenses: 'ledgerExpense' };
const META = 'sl_settings';
export const CATEGORIES = ['Registration', 'Team fee', 'Hotel', 'Gas', 'Tournament', 'Equipment', 'Food', 'Other'];
export const STATUSES = ['Paid', 'Due', 'Reimbursed'];
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cleanColor = color => /^#[a-f0-9]{6}$/i.test(color || '') ? color : '#2e7dd1';

export function seedLedger() {
  const year = new Date().getFullYear();
  return { v: 1, season: `${year}–${String(year + 1).slice(-2)}`, payers: ['Kevin', 'Kate'],
    kids: [{ id: 'sl_kid_luke', name: 'Luke', color: '#2e7dd1' }, { id: 'sl_kid_max', name: 'Max', color: '#d1552e' }],
    teams: [{ id: 'sl_team_luke', kidId: 'sl_kid_luke', name: '', sport: 'Volleyball', budget: 0 }, { id: 'sl_team_max', kidId: 'sl_kid_max', name: '', sport: 'Soccer', budget: 0 }],
    expenses: [], settings: { fuelPrice: 1.55, lPer100: 10.5 } };
}

export function readLedger(hub) {
  const initial = seedLedger(), meta = hub.get(META);
  const state = { v: 1, season: meta?.season ?? initial.season, payers: clone(meta?.payers ?? initial.payers), settings: { ...initial.settings, ...meta?.settings } };
  for (const [key, type] of Object.entries(TYPES)) {
    state[key] = clone(hub.list(type));
    // Virtual starter teams have deterministic IDs, so two new devices agree.
    // Never recreate a row another device deleted.
    if (!meta) for (const item of initial[key]) if (!hub.meta(item.id)) state[key].push(clone(item));
  }
  state.kids.forEach(kid => { kid.color = cleanColor(kid.color); });
  return state;
}

function changedFields(before = {}, after = {}) {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => !['id', 'updatedAt', 'deleted'].includes(key) && !equal(before[key], value)));
}

export function saveLedger(hub, before, after) {
  if (!hub.isUnlocked) throw new Error('Unlock Family Hub before editing the budget.');
  const firstSave = !hub.get(META);
  for (const [key, type] of Object.entries(TYPES)) {
    const old = new Map(before[key].map(row => [row.id, row]));
    for (const row of after[key]) {
      if (typeof row.id !== 'string' || !/^sl_[A-Za-z0-9_-]{1,70}$/.test(row.id)) throw new Error('Invalid budget record.');
      const previous = old.get(row.id), current = hub.get(row.id), record = hub.meta(row.id);
      if (record && record.type !== type) throw new Error('Budget record conflicts with another item.');
      if (row.deleted) {
        if (!record) hub.put(type, { id: row.id });
        if (!record?.deleted) hub.remove(row.id);
        continue;
      }
      if (record?.deleted) continue; // A stale editor must not revive a deletion.
      const fields = changedFields(previous, row);
      if (!previous || Object.keys(fields).length || (firstSave && !record)) {
        const next = { ...(current || row), ...fields, id: row.id };
        delete next.deleted;
        if (type === TYPES.kids) next.color = cleanColor(next.color);
        if (type === TYPES.expenses && next.amount !== '' && (!Number.isFinite(Number(next.amount)) || Math.abs(Number(next.amount)) > 1e9)) throw new Error('Enter a valid expense amount.');
        hub.put(type, next);
      }
    }
  }
  const previousMeta = { season: before.season, payers: before.payers };
  const metaFields = changedFields(previousMeta, { season: after.season, payers: after.payers });
  const settingsFields = changedFields(before.settings, after.settings);
  if (firstSave || Object.keys(metaFields).length || Object.keys(settingsFields).length) {
    const current = hub.get(META) || { ...previousMeta, settings: before.settings };
    hub.put('ledgerSettings', { ...current, ...metaFields, id: META, settings: { ...current.settings, ...settingsFields } });
  }
  return readLedger(hub);
}

export function calculateTrip({ km = 0, trips = 1, price = 0, consumption = 0, nights = 0, rate = 0, extra = 0 }) {
  const values = [km, trips, price, consumption, nights, rate, extra].map(Number);
  if (values.some(value => !Number.isFinite(value) || value < 0) || !Number.isInteger(Number(trips)) || !Number.isInteger(Number(nights))) throw new Error('Use non-negative numbers and whole numbers for trips and nights.');
  [km, trips, price, consumption, nights, rate, extra] = values;
  const cents = value => Math.round(value * 100) / 100;
  const gas = cents(km * 2 * trips * consumption / 100 * price), hotel = cents(nights * rate * trips), food = cents(extra * trips);
  if (!Number.isFinite(gas + hotel + food) || gas + hotel + food > 1e9) throw new Error('Trip values are too large.');
  return { gas, hotel, extra: food, total: cents(gas + hotel + food), km: km * 2 * trips };
}

// Prevent spreadsheet formula execution when a CSV is opened in Excel/Sheets.
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unfinished quoted field.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(cells => cells.some(value => value.trim()));
}

export function importExpenses(state, text, uid, date) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('That CSV has no expense rows.');
  if (rows.length > 5001) throw new Error('Import up to 5,000 rows at a time.');
  const head = rows[0].map(cell => cell.trim().toLowerCase());
  for (const key of ['date', 'amount', 'details']) if (!head.includes(key)) throw new Error('CSV needs date, amount and details columns.');
  const result = clone(state);
  for (const [index, cells] of rows.slice(1).entries()) {
    const get = name => String(cells[head.indexOf(name)] || '').trim();
    const amountText = get('amount').replace(/[$,\s]/g, '');
    if (amountText && !/^-?\d+(\.\d{1,2})?$/.test(amountText)) throw new Error(`Check the amount on CSV row ${index + 2}.`);
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || Math.abs(amount) > 1e9) throw new Error(`Amount is too large on CSV row ${index + 2}.`);
    const day = get('date') || date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error(`Use YYYY-MM-DD for the date on CSV row ${index + 2}.`);
    const kidName = get('kid'), teamName = get('team');
    let team;
    if (kidName || teamName) {
      let kid = result.kids.find(k => !k.deleted && k.name.toLowerCase() === kidName.toLowerCase());
      if (!kid && kidName) { kid = { id: uid(), name: kidName, color: '#2e7dd1' }; result.kids.push(kid); }
      team = result.teams.find(t => !t.deleted && (t.name || t.sport || '').toLowerCase() === teamName.toLowerCase() && t.kidId === (kid?.id || ''));
      if (!team) { team = { id: uid(), kidId: kid?.id || '', name: teamName, sport: '', budget: 0 }; result.teams.push(team); }
    }
    result.expenses.push({ id: uid(), date: day, teamId: team?.id || '', category: CATEGORIES.includes(get('category')) ? get('category') : 'Other', desc: get('details'), amount, paidBy: get('paid by'), status: STATUSES.includes(get('status')) ? get('status') : 'Paid', notes: get('notes') });
  }
  return { state: result, count: rows.length - 1 };
}
