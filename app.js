// Family Hub — shared family calendar & dashboard
import CONFIG from './config.js';
import { store, ls, uid } from './store.js';
import * as L from './lib.js';
import { RECIPES, CUISINES, MEAL_TYPES, dailyPicks } from './meals.js';

const { esc } = L;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isWide = () => window.matchMedia('(min-width: 860px)').matches;

/* =====================================================================
   Device preferences (per device, not shared)
   ===================================================================== */
const prefs = Object.assign({
  theme: 'auto', me: '', view: 'month', cursor: L.today(), filter: [], cat: '', split: false,
  weekStart: 0, needsList: 'groceries', needsFor: '', mealCuisine: 'all', mealType: 'all', mealFav: false, mealSearch: '',
  weather: true, dayStart: 7,
}, ls.get('fh.prefs', {}));
prefs.cursor = L.today();
const savePrefs = () => ls.set('fh.prefs', prefs);

/* =====================================================================
   Shared settings + people
   ===================================================================== */
const SETTINGS_ID = 'settings_family';
function settings() {
  const s = store.get(SETTINGS_ID);
  return {
    id: SETTINGS_ID, familyName: CONFIG.FAMILY_NAME || 'Family Hub', people: L.DEFAULT_PEOPLE, showHolidays: true,
    location: CONFIG.LOCATION, ...(s || {}),
  };
}
const saveSettings = (patch) => store.put('settings', { ...settings(), ...patch });
const people = () => settings().people;
const personById = id => people().find(p => p.id === id);
const me = () => personById(prefs.me);
store.by = me()?.name || '';

function evPeople(ev) {
  const all = people();
  if (!ev.people || !ev.people.length) return all;
  return all.filter(p => ev.people.includes(p.id));
}
const isEveryone = ev => !ev.people || !ev.people.length || ev.people.length >= people().length;
function barStyle(list) {
  if (!list.length) return 'var(--accent)';
  if (list.length === 1) return list[0].color;
  const step = 100 / list.length;
  return `linear-gradient(180deg, ${list.map((p, i) => `${p.color} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}
function whoDots(list, max = 4) {
  return `<span class="who">${list.slice(0, max).map(p => `<i style="--pc:${p.color}" title="${esc(p.name)}">${esc(p.name[0])}</i>`).join('')}${list.length > max ? `<i class="more">+${list.length - max}</i>` : ''}</span>`;
}
function avatar(p, size = '') {
  return `<span class="avatar ${size}" style="--pc:${p.color};--pi:${L.ink(p.color)}">${esc(p.emoji || p.name[0])}</span>`;
}

/* =====================================================================
   Event queries
   ===================================================================== */
function passes(ev, filter = prefs.filter, cat = prefs.cat) {
  if (cat && ev.category !== cat) return false;
  if (!filter.length) return true;
  if (!ev.people || !ev.people.length) return true; // everyone
  return ev.people.some(id => filter.includes(id));
}
function sortOcc(a, b) {
  return a.date.localeCompare(b.date) || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (L.toMin(a.ev.start) ?? -1) - (L.toMin(b.ev.start) ?? -1) || (a.ev.title || '').localeCompare(b.ev.title || '');
}
function occBetween(from, to, opts = {}) {
  const filter = opts.filter ?? prefs.filter, cat = opts.cat ?? prefs.cat;
  const out = [];
  for (const ev of store.list('event')) {
    if (!passes(ev, filter, cat)) continue;
    for (const o of L.occurrences(ev, from, to)) { o.allDay = ev.allDay || !ev.start; out.push(o); }
  }
  return out.sort(sortOcc);
}
// map of date → occurrences touching that day (multi-day events repeat on each day)
function byDay(occs, from, to) {
  const map = {};
  for (const o of occs) {
    let d = o.date < from ? from : o.date;
    const end = o.endDate > to ? to : o.endDate;
    for (let i = 0; d <= end && i < 62; i++, d = L.addDays(d, 1)) (map[d] ||= []).push({ ...o, cont: d !== o.date });
  }
  Object.values(map).forEach(list => list.sort((a, b) => (b.endDate > b.date) - (a.endDate > a.date) || sortOcc(a, b)));
  return map;
}
function holidayMap(from, to) {
  if (!settings().showHolidays) return {};
  const m = {};
  for (const h of L.holidaysBetween(from, to)) (m[h.date] ||= []).push(h);
  return m;
}
function conflicts(draft, date) {
  if (draft.allDay || !draft.start) return [];
  const s = L.toMin(draft.start), e = L.toMin(draft.end) ?? s + 60;
  const who = draft.people && draft.people.length ? draft.people : people().map(p => p.id);
  return occBetween(date, date, { filter: [], cat: '' }).filter(o => {
    if (o.ev.id === draft.id || o.allDay) return false;
    const os = L.toMin(o.ev.start), oe = L.toMin(o.ev.end) ?? os + 60;
    if (!(s < oe && os < e)) return false;
    const ow = o.ev.people && o.ev.people.length ? o.ev.people : people().map(p => p.id);
    return ow.some(id => who.includes(id));
  });
}

/* =====================================================================
   Weather (Open-Meteo — free, no key)
   ===================================================================== */
let weather = ls.get('fh.weather', null);
async function loadWeather(force = false) {
  if (!prefs.weather) return;
  const loc = settings().location || CONFIG.LOCATION;
  if (!loc) return;
  const key = `${loc.lat},${loc.lon}`;
  if (!force && weather && weather.key === key && Date.now() - weather.at < 30 * 60 * 1000) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,apparent_temperature&hourly=precipitation_probability,weather_code,temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=10`;
    const res = await fetch(url);
    if (!res.ok) return;
    const j = await res.json();
    const days = {};
    j.daily.time.forEach((d, i) => days[d] = { code: j.daily.weather_code[i], hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]), pop: j.daily.precipitation_probability_max[i] });
    const hours = {};
    j.hourly.time.forEach((t, i) => hours[t.slice(0, 13)] = { pop: j.hourly.precipitation_probability[i], code: j.hourly.weather_code[i], t: Math.round(j.hourly.temperature_2m[i]) });
    weather = { key, at: Date.now(), now: { t: Math.round(j.current.temperature_2m), feels: Math.round(j.current.apparent_temperature), code: j.current.weather_code }, days, hours };
    ls.set('fh.weather', weather);
    renderPage();
  } catch { /* offline — keep cached */ }
}
function weatherFor(date, time) {
  if (!weather || !prefs.weather) return null;
  if (time) { const h = weather.hours[`${date}T${time.slice(0, 2)}`]; if (h) return { ...L.weatherInfo(h.code), pop: h.pop, t: h.t }; }
  const d = weather.days[date]; if (!d) return null;
  return { ...L.weatherInfo(d.code), pop: d.pop, hi: d.hi, lo: d.lo };
}
function evWeatherBadge(o) {
  const c = L.catById(o.ev.category);
  if (!c.outdoor) return '';
  const w = weatherFor(o.date, o.ev.start);
  if (!w) return '';
  return `<span class="wx-badge" title="${esc(w.label)}">${w.icon}${w.pop != null && w.pop >= 20 ? ` ${w.pop}%` : ''}</span>`;
}

/* =====================================================================
   Theme
   ===================================================================== */
function applyTheme() {
  let t = prefs.theme;
  if (t === 'auto') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => prefs.theme === 'auto' && applyTheme());

/* =====================================================================
   Routing
   ===================================================================== */
const PAGES = ['home', 'calendar', 'needs', 'meals', 'person', 'settings'];
function route() {
  const [page, arg] = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
  return { page: PAGES.includes(page) ? page : 'home', arg: arg ? decodeURIComponent(arg) : '' };
}
function go(page, arg) { const h = '#' + page + (arg ? '/' + encodeURIComponent(arg) : ''); if (location.hash === h) renderPage(true); else location.hash = h; }
window.addEventListener('hashchange', () => { closeModal(); renderShellState(); renderPage(true); });

/* =====================================================================
   Toast + modal
   ===================================================================== */
let toastTimer;
function toast(msg, undo) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  el.className = 'show';
  toast.undo = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; toast.undo = null; }, undo ? 6000 : 2600);
}

let modalCleanup = null;
function openModal(html, { wide = false, onClose } = {}) {
  closeModal(true);
  modalRoot.innerHTML = `<div class="overlay" data-act="overlay"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('modal-open');
  modalCleanup = onClose || null;
  requestAnimationFrame(() => { const f = $('.modal [autofocus]') || $('.modal input, .modal button'); if (f && isWide()) f.focus(); });
}
function closeModal(silent) {
  if (!modalRoot.innerHTML) return;
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  const fn = modalCleanup; modalCleanup = null;
  if (fn && !silent) fn();
  if (pendingRender) { pendingRender = false; renderPage(); }
}
function confirmBox(title, text, buttons) {
  return new Promise(resolve => {
    openModal(`<div class="confirm"><h2>${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="btn-col">${buttons.map((b, i) => `<button class="btn ${b.kind || ''}" data-act="confirm-pick" data-i="${i}">${esc(b.label)}</button>`).join('')}
      <button class="btn ghost" data-act="confirm-pick" data-i="-1">Cancel</button></div></div>`, { onClose: () => resolve(null) });
    confirmBox.resolve = (i) => { modalCleanup = null; closeModal(true); resolve(i < 0 ? null : buttons[i].value ?? i); };
  });
}

/* =====================================================================
   Lock screen
   ===================================================================== */
let pinEntry = '';
let pinMsg = '';
function renderLock() {
  const s = settings();
  document.body.classList.add('locked');
  app.innerHTML = `
  <main class="lock">
    <div class="lock-card">
      <div class="lock-logo">🏡</div>
      <h1>${esc(s.familyName)}</h1>
      <p class="muted">Enter the family PIN</p>
      <form class="pin-form" data-submit="unlock" autocomplete="off">
        <input id="pin-input" class="pin-input" inputmode="numeric" pattern="[0-9]*" type="password" maxlength="12" value="${esc(pinEntry)}" aria-label="Family PIN" autocomplete="off" />
        <div class="pin-dots" aria-hidden="true">${Array.from({ length: Math.max(4, pinEntry.length) }, (_, i) => `<i class="${i < pinEntry.length ? 'on' : ''}"></i>`).join('')}</div>
        <p class="pin-msg" role="alert">${esc(pinMsg)}</p>
        <div class="keypad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-act="pin-key" data-k="${n}">${n}</button>`).join('')}
          <button type="button" data-act="pin-key" data-k="back" aria-label="Delete">⌫</button>
          <button type="button" data-act="pin-key" data-k="0">0</button>
          <button type="submit" class="go" aria-label="Unlock">➜</button>
        </div>
      </form>
      ${store.isShared ? '<p class="tiny muted">🔒 Shared family calendar · syncs across devices</p>' : `<p class="tiny muted preview-note">Preview mode · data stays on this device · PIN <b>${esc(ls.get('fh.previewPin', CONFIG.PREVIEW_PIN || '1234'))}</b></p>`}
    </div>
  </main>`;
  const inp = $('#pin-input');
  inp.addEventListener('input', () => { pinEntry = inp.value.replace(/\D/g, '').slice(0, 12); updatePinDots(); });
  if (isWide()) inp.focus();
}
function updatePinDots() {
  const dots = $('.pin-dots'); if (!dots) return;
  dots.innerHTML = Array.from({ length: Math.max(4, pinEntry.length) }, (_, i) => `<i class="${i < pinEntry.length ? 'on' : ''}"></i>`).join('');
  const inp = $('#pin-input'); if (inp && inp.value !== pinEntry) inp.value = pinEntry;
}
async function doUnlock() {
  if (!pinEntry) return;
  const btn = $('.keypad .go'); if (btn) btn.disabled = true;
  pinMsg = 'Checking…'; $('.pin-msg').textContent = pinMsg;
  const res = await store.unlock(pinEntry);
  if (res.ok) {
    pinEntry = ''; pinMsg = '';
    document.body.classList.remove('locked');
    boot();
    if (!prefs.me) setTimeout(askWhoAmI, 300);
    return;
  }
  pinMsg = { wrong_pin: res.remaining != null ? `Wrong PIN · ${res.remaining} tries left` : 'Wrong PIN', locked: `Too many tries — wait ${res.minutes || 15} minutes`, offline: "You're offline — connect to unlock", network: "Can't reach the family server" }[res.error] || ('Error: ' + (res.message || res.error));
  pinEntry = '';
  renderLock();
  $('.lock-card')?.classList.add('shake');
}

function askWhoAmI() {
  openModal(`<div class="who-ask"><h2>Who's using this device?</h2><p class="muted">Used for greetings and "added by". You can change it in Settings.</p>
    <div class="who-grid">${people().map(p => `<button class="who-btn" data-act="set-me" data-id="${p.id}" style="--pc:${p.color}">${avatar(p, 'lg')}<span>${esc(p.name)}</span></button>`).join('')}</div>
    <button class="btn ghost" data-act="close">Skip</button></div>`);
}

/* =====================================================================
   Shell (header, nav, sidebar)
   ===================================================================== */
const NAV = [
  { page: 'home', icon: '🏠', label: 'Home' },
  { page: 'calendar', icon: '📅', label: 'Calendar' },
  { page: 'needs', icon: '🛒', label: 'Needs' },
  { page: 'meals', icon: '🍽️', label: 'Meals' },
  { page: 'settings', icon: '⚙️', label: 'Settings' },
];
function renderShell() {
  document.body.classList.remove('locked');
  app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#home"><span class="brand-logo">🏡</span><span class="brand-name" id="brand-name"></span></a>
      <nav class="side-nav">${NAV.map(n => `<a href="#${n.page}" data-page="${n.page}" class="side-link"><span class="ico">${n.icon}</span>${n.label}</a>`).join('')}</nav>
      <div class="side-people" id="side-people"></div>
      <button class="btn primary block" data-act="new-event">＋ New event</button>
      <div class="side-foot" id="side-sync"></div>
    </aside>
    <div class="content">
      <header class="topbar">
        <a class="brand mobile-only" href="#home"><span class="brand-logo">🏡</span><span class="brand-name" id="brand-name-m"></span></a>
        <div class="top-title" id="top-title"></div>
        <div class="top-actions">
          <span id="sync-pill"></span>
          <a class="icon-btn embed-only" href="./" target="_blank" rel="noopener" title="Open full screen" aria-label="Open full screen">↗</a>
          <button class="icon-btn" data-act="cycle-theme" title="Change theme" aria-label="Change theme">🎨</button>
          <a class="icon-btn mobile-only" href="#settings" aria-label="Settings">⚙️</a>
        </div>
      </header>
      <main id="main" class="main" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" aria-label="Main">
      ${NAV.slice(0, 2).map(n => `<a href="#${n.page}" data-page="${n.page}" class="nav-btn"><span class="ico">${n.icon}</span><span>${n.label}</span></a>`).join('')}
      <button class="nav-add" data-act="new-event" aria-label="New event">＋</button>
      ${NAV.slice(2, 4).map(n => `<a href="#${n.page}" data-page="${n.page}" class="nav-btn"><span class="ico">${n.icon}</span><span>${n.label}</span></a>`).join('')}
    </nav>
  </div>`;
  renderShellState();
}
function renderShellState() {
  const r = route();
  $$('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === r.page || (r.page === 'person' && a.dataset.page === 'home')));
  const name = settings().familyName;
  ['#brand-name', '#brand-name-m'].forEach(s => { const el = $(s); if (el) el.textContent = name; });
  const sp = $('#side-people');
  if (sp) sp.innerHTML = `<div class="side-label">Family</div>` + people().map(p => `<a class="side-person ${r.page === 'person' && r.arg === p.id ? 'active' : ''}" href="#person/${p.id}" style="--pc:${p.color}">${avatar(p, 'sm')}<span>${esc(p.name)}</span><i class="swatch"></i></a>`).join('');
  renderSync();
}
function syncLabel() {
  const s = store.status;
  if (!store.isShared) return { cls: 'local', text: 'Preview · this device' };
  if (s === 'syncing' || store.pending.length) return { cls: 'busy', text: 'Saving…' };
  if (s === 'offline') return { cls: 'warn', text: 'Offline' };
  if (s === 'error') return { cls: 'err', text: 'Sync issue' };
  if (s === 'auth') return { cls: 'err', text: 'Locked' };
  return { cls: 'ok', text: store.lastSync ? 'Synced ' + ago(store.lastSync) : 'Connected' };
}
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago';
}
function renderSync() {
  const l = syncLabel();
  const html = `<button class="sync-pill ${l.cls}" data-act="sync-now" title="${esc(store.statusMessage || 'Tap to sync now')}"><i></i>${esc(l.text)}</button>`;
  const a = $('#sync-pill'); if (a) a.innerHTML = html;
  const b = $('#side-sync'); if (b) b.innerHTML = html;
}

/* =====================================================================
   Page rendering
   ===================================================================== */
let pendingRender = false;
function renderPage(resetScroll = false) {
  const main = $('#main');
  if (!main) return;
  const r = route();
  const top = resetScroll ? 0 : main.scrollTop;
  const title = { home: '', calendar: 'Calendar', needs: 'Needs & Lists', meals: 'Picky Eats', settings: 'Settings', person: personById(r.arg)?.name || '' }[r.page];
  $('#top-title').textContent = title;
  document.body.dataset.page = r.page;
  const html = ({ home: viewHome, calendar: viewCalendar, needs: viewNeeds, meals: viewMeals, person: viewPerson, settings: viewSettings }[r.page] || viewHome)(r.arg);
  main.innerHTML = html;
  main.scrollTop = top;
  if (r.page === 'calendar') afterCalendarRender(resetScroll);
}
// avoid clobbering what someone is typing when a remote update arrives
function softRender() {
  const a = document.activeElement;
  if (modalRoot.innerHTML || (a && a.closest && a.closest('#main') && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = true; return; }
  renderPage();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !modalRoot.innerHTML) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = false; renderPage(); } } }, 50));

function personChips(selected, act = 'filter-person', { all = true } = {}) {
  return `<div class="chips" role="group" aria-label="People">
    ${all ? `<button class="chip ${!selected.length ? 'on' : ''}" data-act="${act}" data-id="">👨‍👩‍👦 Everyone</button>` : ''}
    ${people().map(p => `<button class="chip person ${selected.includes(p.id) ? 'on' : ''}" data-act="${act}" data-id="${p.id}" style="--pc:${p.color}"><i class="dot"></i>${esc(p.name)}</button>`).join('')}
  </div>`;
}

function evRow(o, { showDate = false, compact = false } = {}) {
  const ev = o.ev, c = L.catById(ev.category), who = evPeople(ev);
  const multi = o.endDate !== o.date;
  const time = o.allDay ? (multi ? `${L.fmtDate(o.date, { month: 'short', day: 'numeric' })} – ${L.fmtDate(o.endDate, { month: 'short', day: 'numeric' })}` : 'All day') : L.fmtRange(ev);
  const rides = [ev.dropoff && personById(ev.dropoff) ? `🚗 ${esc(personById(ev.dropoff).name)} drops off` : '', ev.pickup && personById(ev.pickup) ? `🏁 ${esc(personById(ev.pickup).name)} picks up` : ''].filter(Boolean).join(' · ');
  return `<button class="ev-row ${compact ? 'compact' : ''}" data-act="open-event" data-id="${ev.id}" data-date="${o.date}" style="--bar:${barStyle(who)}">
    <span class="bar"></span>
    <span class="ev-ico" style="--cc:${c.color}">${c.icon}</span>
    <span class="ev-main">
      <span class="ev-title">${esc(ev.title || c.name)}${ev.repeat && ev.repeat.freq !== 'none' ? ' <span class="rep" title="Repeats">↻</span>' : ''}</span>
      <span class="ev-sub">${showDate ? `<b>${esc(L.relDay(o.date))}</b> · ` : ''}${esc(time)}${ev.location ? ' · 📍' + esc(ev.location) : ''}</span>
      ${rides && !compact ? `<span class="ev-sub rides">${rides}</span>` : ''}
    </span>
    ${evWeatherBadge(o)}
    ${isEveryone(ev) ? '<span class="who"><i class="all" title="Everyone">All</i></span>' : whoDots(who)}
  </button>`;
}

// Everyday repeating work/school blocks get summarized on the dashboard so games & appointments stand out
const isRoutine = o => ['work', 'school'].includes(o.ev.category) && o.ev.repeat && o.ev.repeat.freq !== 'none';
function routineLine(list, d) {
  if (!list.length) return '';
  const byCat = {};
  list.forEach(o => { const c = o.ev.category; (byCat[c] ||= new Set()); evPeople(o.ev).forEach(p => byCat[c].add(p.name)); });
  return `<button class="routine" data-act="goto-day" data-date="${d}">${Object.entries(byCat).map(([c, names]) => `<span>${L.catById(c).icon} ${esc([...names].join(', '))}</span>`).join('')}<span class="muted">· usual ${Object.keys(byCat).map(c => L.catById(c).name.toLowerCase()).join(' & ')}</span></button>`;
}

/* =====================================================================
   HOME / DASHBOARD
   ===================================================================== */
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function viewHome() {
  const t = L.today();
  const s = settings();
  const occToday = occBetween(t, t);
  const week = occBetween(L.addDays(t, 1), L.addDays(t, 7));
  const wk = weather && prefs.weather ? weather : null;
  const w = wk && wk.now ? L.weatherInfo(wk.now.code) : null;
  const wd = wk && wk.days[t];
  const hol = holidayMap(t, L.addDays(t, 60));
  const todayHol = hol[t] || [];

  // per person next event
  const soon = occBetween(t, L.addDays(t, 14), { filter: [], cat: '' });
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const personCards = people().map(p => {
    const mine = soon.filter(o => !o.ev.people?.length || o.ev.people.includes(p.id));
    const next = mine.find(o => o.date > t || o.allDay || (L.toMin(o.ev.end || o.ev.start) ?? 0) >= nowMin);
    const todayCount = mine.filter(o => o.date === t).length;
    const weekCount = mine.filter(o => o.date <= L.addDays(t, 6)).length;
    const needs = store.list('need').filter(n => !n.done && n.for === p.id).length;
    return `<a class="person-card" href="#person/${p.id}" style="--pc:${p.color};--pi:${L.ink(p.color)}">
      <div class="pc-top">${avatar(p)}<div><b>${esc(p.name)}</b><span class="muted tiny">${todayCount ? `${todayCount} today` : 'Free today'} · ${weekCount} this week</span></div></div>
      <div class="pc-next">${next ? `<span class="ev-ico sm">${L.catById(next.ev.category).icon}</span><span><b>${esc(next.ev.title)}</b><br><span class="muted tiny">${esc(L.relDay(next.date))}${next.allDay ? '' : ' · ' + L.fmtTime(next.ev.start)}</span></span>` : '<span class="muted tiny">Nothing coming up</span>'}</div>
      ${needs ? `<span class="pc-badge">🛒 ${needs}</span>` : ''}
    </a>`;
  }).join('');

  // upcoming grouped
  const groups = {};
  week.forEach(o => (groups[o.date] ||= []).push(o));
  const upcoming = Object.keys(groups).sort().map(d => {
    const routine = groups[d].filter(isRoutine), rest = groups[d].filter(o => !isRoutine(o));
    return `<div class="day-group"><div class="dg-head"><b>${esc(L.relDay(d))}</b><span class="muted tiny">${L.fmtDate(d, { month: 'short', day: 'numeric' })}</span>${wk && wk.days[d] ? `<span class="wx-mini">${L.weatherInfo(wk.days[d].code).icon} ${wk.days[d].hi}°</span>` : ''}</div>${rest.map(o => evRow(o, { compact: true })).join('')}${routineLine(routine, d)}</div>`;
  }).join('');

  // needs snapshot
  const needs = store.list('need').filter(n => !n.done);
  const needCounts = L.NEED_LISTS.map(l => ({ ...l, n: needs.filter(x => x.list === l.id).length })).filter(l => l.n);
  const urgent = needs.filter(n => n.urgent).slice(0, 4);

  // dinner tonight
  const plan = store.get('mp_' + t);
  const planned = plan && (plan.recipeId ? recipeById(plan.recipeId) : null);
  const picks = dailyPicks(t, 3);

  // countdowns
  const cds = [];
  soon.concat(occBetween(L.addDays(t, 15), L.addDays(t, 90), { filter: [], cat: '' })).forEach(o => {
    if ((o.ev.countdown || o.ev.category === 'birthday') && o.date > t && !cds.find(c => c.key === o.ev.id)) cds.push({ key: o.ev.id, date: o.date, name: o.ev.title, icon: L.catById(o.ev.category).icon });
  });
  Object.values(hol).flat().forEach(h => { if (h.date > t && !['Valentine\'s Day'].includes(h.name)) cds.push({ key: h.name, date: h.date, name: h.name, icon: h.icon }); });
  cds.sort((a, b) => a.date.localeCompare(b.date));

  // week mix
  const mix = {};
  occBetween(t, L.addDays(t, 6)).forEach(o => mix[o.ev.category] = (mix[o.ev.category] || 0) + 1);

  // notes
  const notes = store.list('note').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.at || 0) - (a.at || 0)).slice(0, 8);

  return `
  <section class="hero card">
    <div class="hero-text">
      <p class="eyebrow">${esc(L.fmtDate(t, { weekday: 'long', month: 'long', day: 'numeric' }))}</p>
      <h1>${greeting()}${me() ? ', ' + esc(me().name) : ''}!</h1>
      <p class="muted">${occToday.length ? `${occToday.length} thing${occToday.length > 1 ? 's' : ''} on today` : 'Nothing planned today'}${todayHol.length ? ' · ' + todayHol.map(h => h.icon + ' ' + esc(h.name)).join(', ') : ''}</p>
      <div class="hero-actions">
        <button class="btn primary" data-act="new-event">＋ Event</button>
        <button class="btn" data-act="quick-need">＋ Need</button>
        <button class="btn" data-act="new-note">📝 Note</button>
      </div>
    </div>
    ${w ? `<button class="hero-wx" data-act="weather-detail" title="${esc(s.location?.name || '')}"><span class="wx-ico">${w.icon}</span><span class="wx-t">${wk.now.t}°</span><span class="muted tiny">${esc(w.label)}${wd ? ` · H ${wd.hi}° L ${wd.lo}°` : ''}</span><span class="muted tiny">${esc(s.location?.name || '')}</span></button>` : ''}
  </section>

  ${personChips(prefs.filter)}

  <div class="dash">
    <section class="card pad d-today">
      <div class="sec-head"><h2>Today</h2><button class="link" data-act="goto-day" data-date="${t}">Day view →</button></div>
      ${occToday.length ? `<div class="timeline">${occToday.map(o => evRow(o)).join('')}</div>` : `<div class="empty"><span>🌤️</span><p>Nothing on the calendar today.</p><button class="btn sm" data-act="new-event" data-date="${t}">Add something</button></div>`}
    </section>

    <section class="d-people">
      <div class="person-grid">${personCards}</div>
    </section>

    <section class="card pad d-dinner">
      <div class="sec-head"><h2>🍽️ Tonight's dinner</h2><a class="link" href="#meals">Picky Eats →</a></div>
      ${planned ? `<button class="dinner-planned" data-act="open-recipe" data-id="${planned.id}"><span class="big-emoji">${planned.emoji}</span><span><b>${esc(planned.name)}</b><br><span class="muted tiny">${cuisineFlag(planned.cuisine)} ${esc(cuisineName(planned.cuisine))} · ${planned.time} min</span></span></button>`
        : plan && plan.text ? `<div class="dinner-planned"><span class="big-emoji">🍲</span><b>${esc(plan.text)}</b></div>`
        : `<p class="muted tiny">Not planned yet — today's picky-proof ideas:</p><div class="mini-recipes">${picks.map(r => `<button class="mini-recipe" data-act="open-recipe" data-id="${r.id}"><span>${r.emoji}</span><b>${esc(r.name)}</b><small>${cuisineFlag(r.cuisine)} ${r.time} min</small></button>`).join('')}</div>`}
    </section>

    <section class="card pad d-upcoming">
      <div class="sec-head"><h2>Next 7 days</h2><button class="link" data-act="goto-view" data-view="week">Week →</button></div>
      ${upcoming || '<p class="muted">Clear week ahead.</p>'}
    </section>

    <section class="card pad d-needs">
      <div class="sec-head"><h2>🛒 Needs</h2><a class="link" href="#needs">All lists →</a></div>
      <form class="quick-add" data-submit="dash-need"><input name="text" placeholder="Add to groceries…" aria-label="Add a need" /><button class="btn sm primary">Add</button></form>
      ${needCounts.length ? `<div class="need-counts">${needCounts.map(l => `<button class="need-count" data-act="goto-needs" data-list="${l.id}"><span>${l.icon}</span><b>${l.n}</b><small>${esc(l.name)}</small></button>`).join('')}</div>` : '<p class="muted tiny">All stocked up!</p>'}
      ${urgent.length ? `<div class="urgent-list">${urgent.map(n => `<div class="urgent">❗ ${esc(n.text)}${n.for && personById(n.for) ? ` <span class="tag" style="--pc:${personById(n.for).color}">${esc(personById(n.for).name)}</span>` : ''}</div>`).join('')}</div>` : ''}
    </section>

    <section class="card pad d-notes">
      <div class="sec-head"><h2>📌 Fridge notes</h2><button class="link" data-act="new-note">＋ Add</button></div>
      ${notes.length ? `<div class="notes">${notes.map(n => { const p = personById(n.by); return `<div class="note" style="--pc:${p ? p.color : 'var(--accent)'}"><p>${esc(n.text)}</p><div class="note-foot"><span>${p ? esc(p.name) : ''} · ${ago(n.at || 0)}</span><span><button class="icon-btn xs" data-act="pin-note" data-id="${n.id}" title="Pin">${n.pinned ? '📌' : '📍'}</button><button class="icon-btn xs" data-act="del-note" data-id="${n.id}" title="Remove">✕</button></span></div></div>`; }).join('')}</div>` : '<p class="muted tiny">Leave a note for the family — "Practice moved to 6!"</p>'}
    </section>

    <section class="card pad d-count">
      <div class="sec-head"><h2>⏳ Countdowns</h2></div>
      ${cds.length ? `<div class="countdowns">${cds.slice(0, 5).map(c => { const d = L.diffDays(t, c.date); return `<div class="cd"><span class="cd-ico">${c.icon}</span><span class="cd-name">${esc(c.name)}<small class="muted">${L.fmtDate(c.date, { month: 'short', day: 'numeric' })}</small></span><b>${d}<small>day${d === 1 ? '' : 's'}</small></b></div>`; }).join('')}</div>` : '<p class="muted tiny">Birthdays and events marked "countdown" show here.</p>'}
    </section>

    <section class="card pad d-mix">
      <div class="sec-head"><h2>This week</h2></div>
      ${Object.keys(mix).length ? `<div class="mix">${Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([id, n]) => { const c = L.catById(id); return `<button class="mix-item" data-act="filter-cat-go" data-cat="${id}" style="--cc:${c.color}"><span>${c.icon}</span><b>${n}</b><small>${esc(c.name)}</small></button>`; }).join('')}</div>` : '<p class="muted tiny">No activities this week yet.</p>'}
    </section>
  </div>`;
}

/* =====================================================================
   CALENDAR
   ===================================================================== */
const VIEWS = [
  { id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'day', label: 'Day' },
  { id: 'family', label: 'Family' }, { id: 'list', label: 'List' },
];
function calTitle() {
  const c = prefs.cursor;
  if (prefs.view === 'month') return L.fmtDate(c, { month: 'long', year: 'numeric' });
  if (prefs.view === 'day') return L.fmtDate(c, isWide() ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
  if (prefs.view === 'list') return 'From ' + L.fmtDate(c, { month: 'short', day: 'numeric' });
  const s = L.startOfWeek(c, prefs.weekStart), e = L.addDays(s, 6);
  return s.slice(0, 7) === e.slice(0, 7) ? `${L.fmtDate(s, { month: 'long', day: 'numeric' })} – ${L.parse(e).getDate()}` : `${L.fmtDate(s, { month: 'short', day: 'numeric' })} – ${L.fmtDate(e, { month: 'short', day: 'numeric' })}`;
}
function viewCalendar() {
  const catOpts = `<option value="">All activities</option>` + L.CATEGORIES.map(c => `<option value="${c.id}" ${prefs.cat === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
  const body = { month: calMonth, week: calWeek, day: calDay, family: calFamily, list: calList }[prefs.view] || calMonth;
  return `
  <div class="cal-toolbar">
    <div class="cal-nav">
      <button class="icon-btn" data-act="cal-prev" aria-label="Previous">‹</button>
      <button class="btn sm" data-act="cal-today">Today</button>
      <button class="icon-btn" data-act="cal-next" aria-label="Next">›</button>
      <h2 class="cal-title">${esc(calTitle())}</h2>
    </div>
    <div class="seg" role="tablist">${VIEWS.map(v => `<button role="tab" class="${prefs.view === v.id ? 'on' : ''}" data-act="set-view" data-view="${v.id}">${v.label}</button>`).join('')}</div>
  </div>
  <div class="cal-filters">
    ${personChips(prefs.filter)}
    <div class="filter-row">
      <select class="select sm" data-change="filter-cat" aria-label="Activity filter">${catOpts}</select>
      ${prefs.view === 'day' ? `<label class="toggle"><input type="checkbox" data-change="split" ${prefs.split ? 'checked' : ''}/><span></span>Split by person</label>` : ''}
      ${prefs.view === 'day' || prefs.view === 'week' ? `<button class="btn sm ghost" data-act="share-range">📤 Share</button>` : ''}
      <button class="btn sm ghost wide-only" data-act="print">🖨️ Print</button>
    </div>
  </div>
  <div class="cal-body view-${prefs.view}">${body()}</div>`;
}

/* ---- Month ---- */
function calMonth() {
  const first = L.startOfMonth(prefs.cursor);
  const gridStart = L.startOfWeek(first, prefs.weekStart);
  const gridEnd = L.addDays(gridStart, 41);
  const occs = occBetween(gridStart, gridEnd);
  const map = byDay(occs, gridStart, gridEnd);
  const hol = holidayMap(gridStart, gridEnd);
  const t = L.today(), month = first.slice(0, 7);
  const heads = Array.from({ length: 7 }, (_, i) => DAY_NAMES[(i + prefs.weekStart) % 7]);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = L.addDays(gridStart, i);
    const list = map[d] || [];
    const hs = hol[d] || [];
    const w = weatherFor(d);
    const cls = [d.slice(0, 7) !== month ? 'out' : '', d === t ? 'today' : '', d === prefs.cursor ? 'sel' : '', [0, 6].includes(L.dow(d)) ? 'wkend' : ''].join(' ');
    cells += `<div class="m-cell ${cls}" data-act="select-day" data-date="${d}" role="gridcell" aria-label="${L.fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} events">
      <div class="m-head"><span class="m-num">${L.parse(d).getDate()}</span>${w && d >= t ? `<span class="m-wx" title="${esc(w.label)} ${w.hi}°">${w.icon}</span>` : ''}</div>
      ${hs.map(h => `<div class="m-hol" title="${esc(h.name)}">${h.icon} <span>${esc(h.name)}</span></div>`).join('')}
      <div class="m-events">${list.slice(0, 3).map(o => { const who = evPeople(o.ev); const c = L.catById(o.ev.category); return `<button class="pill ${o.allDay ? 'allday' : ''} ${o.cont ? 'cont' : ''}" data-act="open-event" data-id="${o.ev.id}" data-date="${o.date}" style="--bar:${barStyle(who)};--pc:${who[0]?.color || 'var(--accent)'}">${c.icon}<span class="pt">${o.allDay ? '' : `<b>${L.fmtTime(o.ev.start)}</b> `}${esc(o.ev.title || c.name)}</span></button>`; }).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ''}</div>
      <div class="m-dots">${list.slice(0, 5).map(o => `<i style="--bar:${barStyle(evPeople(o.ev))}"></i>`).join('')}${list.length > 5 ? '<b>+</b>' : ''}</div>
    </div>`;
  }
  const sel = prefs.cursor;
  const selList = occBetween(sel, sel);
  return `<div class="month card">
    <div class="m-heads">${heads.map(h => `<div>${h}</div>`).join('')}</div>
    <div class="m-grid" role="grid">${cells}</div>
  </div>
  <section class="card pad sel-day">
    <div class="sec-head"><h2>${esc(L.relDay(sel))} <span class="muted tiny">${L.fmtDate(sel, { month: 'long', day: 'numeric' })}</span></h2>
      <div class="row"><button class="btn sm" data-act="goto-day" data-date="${sel}">Day view</button><button class="btn sm primary" data-act="new-event" data-date="${sel}">＋ Add</button></div></div>
    ${(hol[sel] || []).map(h => `<div class="hol-row">${h.icon} ${esc(h.name)}</div>`).join('')}
    ${selList.length ? selList.map(o => evRow(o)).join('') : '<p class="muted">Nothing planned.</p>'}
  </section>`;
}

/* ---- Time grid shared by Week & Day ---- */
const HOUR_PX = 52;
function timeRange(occs) {
  let start = prefs.dayStart ?? 7, end = 22;
  occs.forEach(o => { if (!o.allDay) { start = Math.min(start, Math.floor(L.toMin(o.ev.start) / 60)); end = Math.max(end, Math.ceil((L.toMin(o.ev.end) ?? L.toMin(o.ev.start) + 60) / 60)); } });
  return [Math.max(0, start), Math.min(24, end)];
}
function timeGrid(columns, occs) {
  // columns: [{ key, date, label, sub, filter(o)=>bool, color }]
  const [h0, h1] = timeRange(occs);
  const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  const t = L.today();
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const allDayRow = columns.map(col => {
    const list = occs.filter(o => o.allDay && o.date <= col.date && o.endDate >= col.date && col.filter(o));
    const hol = (holidayMap(col.date, col.date)[col.date] || []);
    return `<div class="tg-allday-cell">${hol.map(h => `<div class="m-hol">${h.icon} ${esc(h.name)}</div>`).join('')}${list.map(o => { const who = evPeople(o.ev); return `<button class="pill allday" data-act="open-event" data-id="${o.ev.id}" data-date="${o.date}" style="--bar:${barStyle(who)};--pc:${who[0]?.color}">${L.catById(o.ev.category).icon}<span class="pt">${esc(o.ev.title)}</span></button>`; }).join('')}</div>`;
  }).join('');
  const cols = columns.map(col => {
    const items = occs.filter(o => !o.allDay && o.date === col.date && col.filter(o)).map(o => {
      const s = L.toMin(o.ev.start), e = Math.max(s + 30, L.toMin(o.ev.end) ?? s + 60);
      return { o, s, e };
    });
    const laid = L.layoutDay(items);
    const evs = laid.map(({ o, s, e, col: c, cols: n }) => {
      const who = evPeople(o.ev); const cat = L.catById(o.ev.category);
      const top = (s - h0 * 60) / 60 * HOUR_PX, height = Math.max(22, (e - s) / 60 * HOUR_PX - 2);
      return `<button class="tg-ev ${height < 40 ? 'short' : ''}" data-act="open-event" data-id="${o.ev.id}" data-date="${o.date}" style="top:${top}px;height:${height}px;left:calc(${c / n * 100}% + 2px);width:calc(${100 / n}% - 4px);--bar:${barStyle(who)};--pc:${who[0]?.color || 'var(--accent)'}">
        <span class="tg-t">${cat.icon} ${esc(o.ev.title || cat.name)}</span><span class="tg-s">${L.fmtRange(o.ev)}${o.ev.location ? ' · ' + esc(o.ev.location) : ''}</span>${evWeatherBadge(o)}</button>`;
    }).join('');
    const now = col.date === t && nowMin >= h0 * 60 && nowMin <= h1 * 60 ? `<div class="now-line" style="top:${(nowMin - h0 * 60) / 60 * HOUR_PX}px"></div>` : '';
    return `<div class="tg-col ${col.date === t ? 'today' : ''}" data-act="slot" data-date="${col.date}" data-h0="${h0}" data-person="${col.person || ''}" style="height:${hours.length * HOUR_PX}px">${hours.map(() => '<div class="tg-slot"></div>').join('')}${evs}${now}</div>`;
  }).join('');
  return `<div class="tg card" style="--cols:${columns.length}">
    <div class="tg-scroll">
      <div class="tg-head"><div class="tg-gutter"></div>${columns.map(c => `<div class="tg-colhead ${c.date === t ? 'today' : ''}" ${c.color ? `style="--pc:${c.color}"` : ''}>${c.label}</div>`).join('')}</div>
      <div class="tg-allday"><div class="tg-gutter tiny muted">all‑day</div>${allDayRow}</div>
      <div class="tg-body" id="tg-body"><div class="tg-hours">${hours.map(h => `<div class="tg-hour"><span>${L.fmtTime(L.fromMin(h * 60))}</span></div>`).join('')}</div>${cols}</div>
    </div>
  </div>`;
}

/* ---- Week ---- */
function calWeek() {
  const s = L.startOfWeek(prefs.cursor, prefs.weekStart), e = L.addDays(s, 6);
  const occs = occBetween(s, e);
  if (!isWide()) return weekStack(s, e, occs);
  const cols = Array.from({ length: 7 }, (_, i) => { const d = L.addDays(s, i); const w = weatherFor(d); return { date: d, label: `<button class="linkish" data-act="goto-day" data-date="${d}"><span class="tiny muted">${DAY_NAMES[L.dow(d)]}</span> <b>${L.parse(d).getDate()}</b></button>${w ? ` <span class="tiny" title="${esc(w.label)}">${w.icon}${w.hi}°</span>` : ''}`, filter: () => true }; });
  return timeGrid(cols, occs);
}
function weekStack(s, e, occs) {
  const map = byDay(occs, s, e);
  const hol = holidayMap(s, e);
  const t = L.today();
  return `<div class="week-stack">${Array.from({ length: 7 }, (_, i) => {
    const d = L.addDays(s, i); const list = map[d] || []; const w = weatherFor(d);
    return `<section class="card ws-day ${d === t ? 'today' : ''}">
      <div class="ws-head" data-act="goto-day" data-date="${d}"><div class="ws-date"><b>${L.parse(d).getDate()}</b><span>${DAY_NAMES[L.dow(d)]}</span></div>
        <div class="ws-meta">${(hol[d] || []).map(h => `<span class="tag">${h.icon} ${esc(h.name)}</span>`).join('')}${w ? `<span class="tiny muted">${w.icon} ${w.hi}°/${w.lo}°</span>` : ''}</div>
        <button class="icon-btn sm" data-act="new-event" data-date="${d}" aria-label="Add on ${d}">＋</button></div>
      ${list.length ? list.map(o => evRow(o, { compact: true })).join('') : '<p class="muted tiny ws-empty">Free</p>'}
    </section>`;
  }).join('')}</div>`;
}

/* ---- Day ---- */
function calDay() {
  const d = prefs.cursor;
  const occs = occBetween(d, d);
  const w = weatherFor(d);
  const header = w ? `<div class="day-wx card pad">${w.icon} <b>${w.hi}° / ${w.lo}°</b> <span class="muted">${esc(w.label)}${w.pop ? ` · ${w.pop}% chance of precipitation` : ''}</span></div>` : '';
  let cols;
  if (prefs.split) {
    const shown = prefs.filter.length ? people().filter(p => prefs.filter.includes(p.id)) : people();
    cols = shown.map(p => ({ date: d, person: p.id, color: p.color, label: `<span class="colhead-person">${isWide() || shown.length < 3 ? avatar(p, 'xs') : ''} ${esc(p.name)}</span>`, filter: o => !o.ev.people?.length || o.ev.people.includes(p.id) }));
  } else {
    cols = [{ date: d, label: `<b>${L.fmtDate(d, { weekday: 'long' })}</b>`, filter: () => true }];
  }
  return header + timeGrid(cols, occs);
}

/* ---- Family (people × days) ---- */
function calFamily() {
  const s = L.startOfWeek(prefs.cursor, prefs.weekStart), e = L.addDays(s, 6);
  const occs = occBetween(s, e, { filter: [] });
  const map = byDay(occs, s, e);
  const t = L.today();
  const days = Array.from({ length: 7 }, (_, i) => L.addDays(s, i));
  const shown = prefs.filter.length ? people().filter(p => prefs.filter.includes(p.id)) : people();
  const cell = (d, test) => (map[d] || []).filter(test).map(o => { const c = L.catById(o.ev.category); return `<button class="fam-ev" data-act="open-event" data-id="${o.ev.id}" data-date="${o.date}" style="--cc:${c.color}">${c.icon} <span>${o.allDay ? '' : `<b>${L.fmtTime(o.ev.start)}</b> `}${esc(o.ev.title)}</span></button>`; }).join('');
  const rows = [
    `<div class="fam-row everyone"><div class="fam-name"><span class="avatar sm family">👨‍👩‍👦</span><span>Everyone</span></div>${days.map(d => `<div class="fam-cell ${d === t ? 'today' : ''}" data-act="new-event" data-date="${d}">${cell(d, o => isEveryone(o.ev))}</div>`).join('')}</div>`,
    ...shown.map(p => `<div class="fam-row" style="--pc:${p.color}"><div class="fam-name">${avatar(p, 'sm')}<span>${esc(p.name)}</span></div>${days.map(d => `<div class="fam-cell ${d === t ? 'today' : ''}" data-act="new-event" data-date="${d}" data-person="${p.id}">${cell(d, o => !isEveryone(o.ev) && o.ev.people.includes(p.id))}</div>`).join('')}</div>`),
  ].join('');
  return `<div class="family card"><div class="fam-scroll"><div class="fam-grid">
    <div class="fam-row head"><div class="fam-name"></div>${days.map(d => `<div class="fam-dh ${d === t ? 'today' : ''}" data-act="goto-day" data-date="${d}"><span>${DAY_NAMES[L.dow(d)]}</span><b>${L.parse(d).getDate()}</b></div>`).join('')}</div>
    ${rows}</div></div></div>
    <p class="muted tiny center">Tap an empty square to add an event for that person and day.</p>`;
}

/* ---- List / agenda ---- */
let listSearch = '';
function calList() {
  const from = prefs.cursor, to = L.addDays(from, 90);
  let occs = occBetween(from, to);
  const q = listSearch.trim().toLowerCase();
  if (q) occs = occs.filter(o => [o.ev.title, o.ev.location, o.ev.notes, L.catById(o.ev.category).name, ...evPeople(o.ev).map(p => p.name)].join(' ').toLowerCase().includes(q));
  const groups = {};
  occs.forEach(o => (groups[o.date] ||= []).push(o));
  const hol = holidayMap(from, to);
  const keys = [...new Set([...Object.keys(groups), ...(q ? [] : Object.keys(hol))])].sort();
  return `<div class="list-search"><input class="input" type="search" placeholder="Search events, places, people…" value="${esc(listSearch)}" data-input="list-search" aria-label="Search events"/></div>
  <div class="agenda">${keys.length ? keys.map(d => `<section class="ag-day"><div class="ag-head ${d === L.today() ? 'today' : ''}"><b>${esc(L.relDay(d))}</b><span class="muted tiny">${L.fmtDate(d, { month: 'long', day: 'numeric' })}</span></div>
    ${(hol[d] || []).map(h => `<div class="hol-row">${h.icon} ${esc(h.name)}</div>`).join('')}${(groups[d] || []).map(o => evRow(o)).join('')}</section>`).join('') : '<div class="empty"><span>🔍</span><p>No events found.</p></div>'}</div>`;
}

function afterCalendarRender(reset) {
  const body = $('#tg-body');
  const scroller = body && body.closest('.tg-scroll');
  if (scroller && reset) {
    const h0 = Number($('.tg-col')?.dataset.h0 || 0);
    const target = prefs.cursor === L.today() ? Math.max(0, new Date().getHours() - 1) : 8;
    scroller.scrollTop = Math.max(0, (target - h0) * HOUR_PX);
  }
}
function calShift(dir) {
  const c = prefs.cursor;
  prefs.cursor = { month: L.addMonths(c, dir), week: L.addDays(c, 7 * dir), family: L.addDays(c, 7 * dir), day: L.addDays(c, dir), list: L.addDays(c, 30 * dir) }[prefs.view] || c;
  savePrefs(); renderPage();
}

/* =====================================================================
   EVENT EDITOR
   ===================================================================== */
let draft = null; // { ev, occDate, isNew }
function openEvent(id, occDate) {
  const ev = store.get(id);
  if (!ev) return toast('That event was removed');
  draft = { ev: structuredClone(ev), occDate: occDate || ev.date, isNew: false, onlyThis: false };
  renderEditor();
}
function newEvent(date, extra = {}) {
  const d = date || (route().page === 'calendar' ? prefs.cursor : L.today());
  const who = extra.person ? [extra.person] : (prefs.filter.length ? [...prefs.filter] : (me() ? [me().id] : []));
  const cat = extra.category || prefs.cat || 'family';
  draft = {
    ev: { id: '', title: '', category: cat, people: who, date: d, endDate: '', allDay: false, start: extra.start || '18:00', end: extra.end || L.fromMin(Math.min(23 * 60 + 59, L.toMin(extra.start || '18:00') + 60)), location: '', notes: '', bring: L.catById(cat).bring || '', repeat: { freq: 'none', interval: 1, days: [], until: '' }, exdates: [], dropoff: '', pickup: '', countdown: false },
    occDate: d, isNew: true, onlyThis: false,
  };
  renderEditor();
}
function renderEditor() {
  const { ev, isNew, occDate } = draft;
  const r = ev.repeat || { freq: 'none' };
  const recurring = r.freq && r.freq !== 'none';
  const conf = conflicts(ev, draft.onlyThis ? occDate : ev.date);
  const pOpts = sel => `<option value="">—</option>` + people().map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const everyone = !ev.people.length;
  openModal(`
  <form class="editor" data-submit="save-event" novalidate>
    <div class="modal-head"><h2>${isNew ? 'New event' : 'Edit event'}</h2><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      <input class="input title-input" name="title" placeholder="${esc(L.catById(ev.category).name)} — what's happening?" value="${esc(ev.title)}" data-input="ed-field" data-field="title" ${isNew ? 'autofocus' : ''} maxlength="120"/>

      <div class="field"><span class="label">Activity</span>
        <div class="cat-grid">${L.CATEGORIES.map(c => `<button type="button" class="cat-btn ${ev.category === c.id ? 'on' : ''}" data-act="ed-cat" data-id="${c.id}" style="--cc:${c.color}"><span>${c.icon}</span><small>${esc(c.name)}</small></button>`).join('')}</div>
      </div>

      <div class="field"><span class="label">Who</span>
        <div class="chips">
          <button type="button" class="chip ${everyone ? 'on' : ''}" data-act="ed-who" data-id="">👨‍👩‍👦 Everyone</button>
          ${people().map(p => `<button type="button" class="chip person ${ev.people.includes(p.id) ? 'on' : ''}" data-act="ed-who" data-id="${p.id}" style="--pc:${p.color}"><i class="dot"></i>${esc(p.name)}</button>`).join('')}
        </div>
      </div>

      ${recurring && !isNew ? `<label class="toggle note-box"><input type="checkbox" data-change="ed-only" ${draft.onlyThis ? 'checked' : ''}/><span></span>Only change ${esc(L.fmtDate(occDate))} (not the whole series)</label>` : ''}

      <div class="grid2">
        <label class="field"><span class="label">Date</span><input class="input" type="date" value="${draft.onlyThis ? (draft.onlyDate || occDate) : ev.date}" data-change="ed-date" required/></label>
        <label class="field"><span class="label">&nbsp;</span><span class="toggle"><input type="checkbox" data-change="ed-allday" ${ev.allDay ? 'checked' : ''}/><span></span>All day</span></label>
      </div>
      ${ev.allDay ? `<label class="field"><span class="label">Ends (for multi-day, e.g. tournaments/trips)</span><input class="input" type="date" value="${esc(ev.endDate || '')}" min="${ev.date}" data-change="ed-field" data-field="endDate"/></label>`
        : `<div class="grid2"><label class="field"><span class="label">Starts</span><input class="input" type="time" value="${esc(ev.start)}" data-change="ed-start" step="300"/></label><label class="field"><span class="label">Ends</span><input class="input" type="time" value="${esc(ev.end)}" data-change="ed-field" data-field="end" step="300"/></label></div>`}
      ${conf.length ? `<div class="warn-box">⚠️ Heads up: ${conf.map(o => `${esc(evPeople(o.ev).map(p => p.name).join(' & '))} ${evPeople(o.ev).length > 1 ? 'have' : 'has'} <b>${esc(o.ev.title)}</b> ${L.fmtRange(o.ev)}`).join('; ')}</div>` : ''}

      ${draft.onlyThis ? '' : `<div class="field"><span class="label">Repeats</span>
        <div class="grid2">
          <select class="select" data-change="ed-freq">${[['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']].map(([v, l]) => `<option value="${v}" ${r.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${recurring ? `<select class="select" data-change="ed-interval">${[1, 2, 3, 4].map(n => `<option value="${n}" ${Number(r.interval || 1) === n ? 'selected' : ''}>${n === 1 ? 'Every' : `Every ${n}`} ${{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq]}${n > 1 ? 's' : ''}</option>`).join('')}</select>` : ''}
        </div>
        ${r.freq === 'weekly' ? `<div class="weekdays">${DAY_NAMES.map((n, i) => `<button type="button" class="wd ${(r.days && r.days.length ? r.days : [L.dow(ev.date)]).includes(i) ? 'on' : ''}" data-act="ed-wd" data-d="${i}">${n[0]}</button>`).join('')}</div>` : ''}
        ${recurring ? `<label class="field inline"><span class="label">Until (optional — e.g. end of season)</span><input class="input" type="date" value="${esc(r.until || '')}" min="${ev.date}" data-change="ed-until"/></label>` : ''}
      </div>`}

      <label class="field"><span class="label">Where</span><input class="input" placeholder="Arena, field, school…" value="${esc(ev.location)}" data-input="ed-field" data-field="location" maxlength="120"/></label>

      <div class="grid2">
        <label class="field"><span class="label">🚗 Drop-off</span><select class="select" data-change="ed-field" data-field="dropoff">${pOpts(ev.dropoff)}</select></label>
        <label class="field"><span class="label">🏁 Pick-up</span><select class="select" data-change="ed-field" data-field="pickup">${pOpts(ev.pickup)}</select></label>
      </div>

      <label class="field"><span class="label">🎒 What to bring</span><input class="input" placeholder="Water bottle, cleats…" value="${esc(ev.bring || '')}" data-input="ed-field" data-field="bring" maxlength="200"/></label>
      <label class="field"><span class="label">Notes</span><textarea class="input" rows="3" placeholder="Jersey colour, coach's number, snack duty…" data-input="ed-field" data-field="notes" maxlength="2000">${esc(ev.notes)}</textarea></label>
      <label class="toggle"><input type="checkbox" data-change="ed-countdown" ${ev.countdown ? 'checked' : ''}/><span></span>Show a countdown on the dashboard</label>
      ${!isNew && ev.createdBy ? `<p class="tiny muted">Added by ${esc(ev.createdBy)}${ev.updatedBy && ev.updatedBy !== ev.createdBy ? ` · edited by ${esc(ev.updatedBy)}` : ''}</p>` : ''}
    </div>
    <div class="modal-foot">
      ${!isNew ? `<button type="button" class="btn danger ghost" data-act="del-event">Delete</button>
        <div class="more-actions"><button type="button" class="btn ghost" data-act="dup-event" title="Duplicate">⧉</button><button type="button" class="btn ghost" data-act="ics-event" title="Add to phone calendar">📲</button></div>` : '<span></span>'}
      <button class="btn primary" type="submit">${isNew ? 'Add event' : 'Save'}</button>
    </div>
  </form>`);
}
function refreshEditor() {
  const body = $('.modal-body'); const st = body ? body.scrollTop : 0;
  const a = document.activeElement; const focusSel = a && a.dataset && a.dataset.field ? `[data-field="${a.dataset.field}"]` : null;
  renderEditor();
  const nb = $('.modal-body'); if (nb) nb.scrollTop = st;
  if (focusSel) $(focusSel)?.focus();
}
function saveEvent() {
  const ev = draft.ev;
  ev.title = (ev.title || '').trim() || L.catById(ev.category).name;
  if (!ev.date) return toast('Pick a date');
  if (!ev.allDay && ev.start && ev.end && ev.end <= ev.start) ev.end = L.fromMin(Math.min(1439, L.toMin(ev.start) + 60));
  if (ev.allDay) { ev.start = ''; ev.end = ''; if (ev.endDate && ev.endDate < ev.date) ev.endDate = ''; } else ev.endDate = '';
  if (ev.repeat?.freq === 'weekly' && (!ev.repeat.days || !ev.repeat.days.length)) ev.repeat.days = [L.dow(ev.date)];
  const who = me()?.name || '';
  if (draft.onlyThis && !draft.isNew) {
    const series = store.get(ev.id);
    const occ = draft.occDate;
    store.put('event', { ...series, exdates: [...new Set([...(series.exdates || []), occ])] });
    const single = { ...ev, id: '', date: draft.onlyDate || occ, repeat: { freq: 'none' }, exdates: [], createdBy: who };
    store.put('event', single);
  } else {
    if (draft.isNew) ev.createdBy = who; else ev.updatedBy = who;
    store.put('event', ev);
  }
  closeModal(true);
  toast(draft.isNew ? 'Event added' : 'Saved');
  renderPage();
}
async function deleteEvent() {
  const ev = draft.ev;
  const recurring = ev.repeat && ev.repeat.freq !== 'none';
  const choice = recurring
    ? await confirmBox('Delete repeating event?', ev.title, [{ label: `Only ${L.fmtDate(draft.occDate)}`, value: 'one' }, { label: 'Every repeat', value: 'all', kind: 'danger' }])
    : await confirmBox('Delete this event?', ev.title, [{ label: 'Delete', value: 'all', kind: 'danger' }]);
  if (!choice) { renderEditor(); return; }
  const original = store.get(ev.id);
  if (choice === 'one') {
    store.put('event', { ...original, exdates: [...new Set([...(original.exdates || []), draft.occDate])] });
    toast('Removed that date', () => store.put('event', original));
  } else {
    store.remove(ev.id);
    toast('Event deleted', () => store.put('event', original));
  }
  renderPage();
}
function icsFor(ev) {
  const d = s => s.replace(/-/g, '');
  const t = s => s.replace(':', '') + '00';
  const escI = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Hub//EN', 'BEGIN:VEVENT', `UID:${ev.id}@family-hub`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`];
  if (ev.allDay || !ev.start) { lines.push(`DTSTART;VALUE=DATE:${d(ev.date)}`, `DTEND;VALUE=DATE:${d(L.addDays(ev.endDate || ev.date, 1))}`); }
  else { lines.push(`DTSTART:${d(ev.date)}T${t(ev.start)}`, `DTEND:${d(ev.date)}T${t(ev.end || L.fromMin(L.toMin(ev.start) + 60))}`); }
  const r = ev.repeat;
  if (r && r.freq !== 'none') {
    let rule = `RRULE:FREQ=${r.freq.toUpperCase()};INTERVAL=${r.interval || 1}`;
    if (r.freq === 'weekly' && r.days?.length) rule += ';BYDAY=' + r.days.map(i => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][i]).join(',');
    if (r.until) rule += `;UNTIL=${d(r.until)}T235959`;
    lines.push(rule);
  }
  lines.push(`SUMMARY:${escI(L.catById(ev.category).icon + ' ' + ev.title)}`);
  if (ev.location) lines.push(`LOCATION:${escI(ev.location)}`);
  const desc = [evPeople(ev).map(p => p.name).join(', '), ev.bring ? 'Bring: ' + ev.bring : '', ev.notes].filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${escI(desc)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = typeof File === 'function' ? new File([blob], name, { type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && !isWide()) { navigator.share({ files: [file] }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* =====================================================================
   NEEDS
   ===================================================================== */
const SIZE_FIELDS = [['shirt', 'Shirt'], ['pants', 'Pants'], ['shoes', 'Shoes'], ['jacket', 'Jacket'], ['other', 'Other']];
function viewNeeds() {
  const all = store.list('need');
  const list = prefs.needsList;
  const forP = prefs.needsFor;
  const inList = all.filter(n => (list === 'all' || n.list === list) && (!forP || n.for === forP));
  const open = inList.filter(n => !n.done).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.at || 0) - (b.at || 0));
  const done = inList.filter(n => n.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const counts = id => all.filter(n => !n.done && (id === 'all' || n.list === id)).length;
  const tabs = [{ id: 'all', name: 'All', icon: '📋' }, ...L.NEED_LISTS];
  const cur = L.NEED_LISTS.find(l => l.id === list);
  const item = n => {
    const p = personById(n.for); const lst = L.NEED_LISTS.find(l => l.id === n.list);
    return `<div class="need ${n.done ? 'done' : ''} ${n.urgent ? 'urgent' : ''}">
      <button class="check" data-act="toggle-need" data-id="${n.id}" aria-label="${n.done ? 'Mark not done' : 'Mark done'}">${n.done ? '✓' : ''}</button>
      <div class="need-main" data-act="edit-need" data-id="${n.id}"><span class="need-text">${esc(n.text)}${n.qty ? ` <span class="qty">× ${esc(n.qty)}</span>` : ''}</span>
        <span class="need-sub">${list === 'all' && lst ? lst.icon + ' ' : ''}${p ? `<span class="tag" style="--pc:${p.color}">${esc(p.name)}</span>` : ''}${n.by ? `<span class="muted tiny">added by ${esc(n.by)}</span>` : ''}</span></div>
      <button class="icon-btn xs ${n.urgent ? 'on' : ''}" data-act="urgent-need" data-id="${n.id}" title="Needed soon">❗</button>
      <button class="icon-btn xs" data-act="del-need" data-id="${n.id}" aria-label="Delete">✕</button>
    </div>`;
  };
  const pSizes = forP ? people().filter(p => p.id === forP) : people();
  return `
  <div class="tabs scroll-x" role="tablist">${tabs.map(t => `<button role="tab" class="tab ${list === t.id ? 'on' : ''}" data-act="needs-list" data-list="${t.id}">${t.icon} ${esc(t.name)}${counts(t.id) ? `<b>${counts(t.id)}</b>` : ''}</button>`).join('')}</div>
  <div class="chips-row">${personChips(forP ? [forP] : [], 'needs-for')}</div>
  <form class="card pad add-need" data-submit="add-need">
    <div class="add-need-top"><input class="input" name="text" placeholder="${cur ? `Add to ${esc(cur.name)}…` : 'Add something we need…'}" required maxlength="120" aria-label="Item"/><button class="btn primary">Add</button></div>
    <div class="add-need-row">
      <input class="input qty-in" name="qty" placeholder="Qty" maxlength="12" aria-label="Quantity"/>
      ${list === 'all' ? `<select class="select" name="list" aria-label="List">${L.NEED_LISTS.map(l => `<option value="${l.id}">${l.icon} ${esc(l.name)}</option>`).join('')}</select>` : ''}
      <select class="select" name="for" aria-label="For who"><option value="">For anyone</option>${people().map(p => `<option value="${p.id}" ${forP === p.id ? 'selected' : ''}>For ${esc(p.name)}</option>`).join('')}</select>
      <label class="toggle sm"><input type="checkbox" name="urgent"/><span></span>Needed soon</label>
    </div>
  </form>
  ${list === 'groceries' ? `<p class="tiny muted hint">💡 Tip: open any recipe in <a href="#meals">Picky Eats</a> and tap "Add to groceries".</p>` : ''}
  <section class="need-list card">
    ${open.length ? open.map(item).join('') : `<div class="empty"><span>✅</span><p>Nothing needed here.</p></div>`}
  </section>
  ${done.length ? `<details class="done-block" ${done.length < 6 ? 'open' : ''}><summary>Done / in the cart (${done.length}) <button class="link" data-act="clear-done">Clear done</button></summary><section class="need-list card">${done.slice(0, 60).map(item).join('')}</section></details>` : ''}
  ${list === 'clothes' || list === 'all' ? `<section class="card pad sizes"><div class="sec-head"><h2>📏 Sizes</h2><span class="muted tiny">Handy when shopping — shared with everyone</span></div>
    <div class="size-grid">${pSizes.map(p => `<div class="size-card" style="--pc:${p.color}"><div class="size-head">${avatar(p, 'sm')}<b>${esc(p.name)}</b></div>
      ${SIZE_FIELDS.map(([k, label]) => `<label><span>${label}</span><input class="input sm" value="${esc(p.sizes?.[k] || '')}" data-change="size" data-person="${p.id}" data-k="${k}" maxlength="24" placeholder="—"/></label>`).join('')}</div>`).join('')}</div></section>` : ''}`;
}
function addNeed({ text, qty = '', list = 'groceries', forP = '', urgent = false }) {
  text = (text || '').trim(); if (!text) return null;
  return store.put('need', { id: '', text, qty: String(qty || '').trim(), list, for: forP, urgent: !!urgent, done: false, by: me()?.name || '', at: Date.now() });
}

/* =====================================================================
   MEALS — Picky Eats
   ===================================================================== */
const cuisineName = id => CUISINES.find(c => c.id === id)?.name || 'Family';
const cuisineFlag = id => CUISINES.find(c => c.id === id)?.flag || '🏡';
const allRecipes = () => [...RECIPES, ...store.list('recipe').map(r => ({ ...r, custom: true }))];
const recipeById = id => allRecipes().find(r => r.id === id);
const recipeMeta = id => store.get('rm_' + id) || { id: 'rm_' + id, likes: [], dislikes: [] };
function viewMeals() {
  const t = L.today();
  const picks = dailyPicks(t, 4);
  const wkStart = L.startOfWeek(t, prefs.weekStart);
  const q = prefs.mealSearch.trim().toLowerCase();
  let list = allRecipes().filter(r => (prefs.mealCuisine === 'all' || r.cuisine === prefs.mealCuisine) && (prefs.mealType === 'all' || r.meal === prefs.mealType));
  if (prefs.mealFav) list = list.filter(r => recipeMeta(r.id).likes?.length);
  if (q) list = list.filter(r => [r.name, cuisineName(r.cuisine), ...(r.tags || []), ...(r.ingredients || [])].join(' ').toLowerCase().includes(q));
  const card = (r, big) => {
    const m = recipeMeta(r.id);
    const likers = (m.likes || []).map(personById).filter(Boolean);
    return `<button class="recipe-card ${big ? 'big' : ''}" data-act="open-recipe" data-id="${r.id}">
      <span class="rc-emoji">${r.emoji || '🍲'}</span>
      <span class="rc-body"><b>${esc(r.name)}</b>
        <span class="rc-meta">${cuisineFlag(r.cuisine)} ${esc(cuisineName(r.cuisine))} · ⏱ ${r.time || '?'} min${r.cook ? ' + ' + esc(r.cook) : ''} · ${esc(r.level || 'Easy')}</span>
        ${big && r.picky?.[0] ? `<span class="rc-tip">💡 ${esc(r.picky[0])}</span>` : ''}
        ${likers.length ? `<span class="rc-likes">${likers.map(p => `<i style="--pc:${p.color}" title="${esc(p.name)} likes this">${esc(p.name[0])}</i>`).join('')} 👍</span>` : ''}
      </span></button>`;
  };
  const plan = Array.from({ length: 7 }, (_, i) => {
    const d = L.addDays(wkStart, i); const p = store.get('mp_' + d); const r = p?.recipeId && recipeById(p.recipeId);
    return `<button class="plan-day ${d === t ? 'today' : ''} ${p ? 'set' : ''}" data-act="plan-day" data-date="${d}"><span class="tiny muted">${DAY_NAMES[L.dow(d)]} ${L.parse(d).getDate()}</span><span class="pd-emoji">${r ? r.emoji : p?.text ? '🍲' : '＋'}</span><span class="pd-name">${r ? esc(r.name) : p?.text ? esc(p.text) : '<span class="muted">Plan</span>'}</span></button>`;
  }).join('');
  return `
  <section class="card pad meal-hero">
    <div class="sec-head"><div><p class="eyebrow">Daily feed · ${L.fmtDate(t, { weekday: 'long', month: 'short', day: 'numeric' })}</p><h2>Today's picky-proof picks</h2></div>
      <button class="btn sm" data-act="surprise">🎲 Surprise me</button></div>
    <div class="picks">${picks.map(r => card(r, true)).join('')}</div>
  </section>
  <section class="card pad">
    <div class="sec-head"><h2>🗓️ This week's dinners</h2><span class="muted tiny">Tap a day to plan</span></div>
    <div class="plan-strip">${plan}</div>
  </section>
  <section class="meal-filters">
    <div class="chips scroll-x">
      <button class="chip ${prefs.mealCuisine === 'all' ? 'on' : ''}" data-act="meal-cuisine" data-id="all">🌍 All</button>
      ${CUISINES.map(c => `<button class="chip ${prefs.mealCuisine === c.id ? 'on' : ''}" data-act="meal-cuisine" data-id="${c.id}">${c.flag} ${c.name}</button>`).join('')}
      <button class="chip ${prefs.mealCuisine === 'family' ? 'on' : ''}" data-act="meal-cuisine" data-id="family">🏡 Ours</button>
    </div>
    <div class="filter-row">
      <div class="seg sm">${['all', ...MEAL_TYPES].map(m => `<button class="${prefs.mealType === m ? 'on' : ''}" data-act="meal-type" data-id="${m}">${m === 'all' ? 'Any meal' : m}</button>`).join('')}</div>
      <button class="chip ${prefs.mealFav ? 'on' : ''}" data-act="meal-fav">👍 Family likes</button>
      <input class="input sm search" type="search" placeholder="Search: chicken, noodles, rice…" value="${esc(prefs.mealSearch)}" data-input="meal-search" aria-label="Search recipes"/>
      <button class="btn sm" data-act="new-recipe">＋ Our recipe</button>
    </div>
  </section>
  <div class="recipe-grid">${list.length ? list.map(r => card(r)).join('') : '<div class="empty"><span>🍽️</span><p>No recipes match.</p></div>'}</div>`;
}
function openRecipe(id) {
  const r = recipeById(id); if (!r) return;
  const m = recipeMeta(id);
  openModal(`
  <div class="recipe">
    <div class="modal-head"><div class="r-title"><span class="r-emoji">${r.emoji || '🍲'}</span><div><h2>${esc(r.name)}</h2><p class="muted tiny">${cuisineFlag(r.cuisine)} ${esc(cuisineName(r.cuisine))} · ${esc(r.meal || '')} · ⏱ ${r.time || '?'} min${r.cook ? ' + ' + esc(r.cook) : ''} · ${esc(r.level || '')}${r.serves ? ` · serves ${r.serves}` : ''}</p></div></div><button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>
    <div class="modal-body">
      ${r.tags?.length ? `<div class="tags">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="likes-row"><span class="label">Who likes it?</span><div class="chips">${people().map(p => `<button class="chip person ${(m.likes || []).includes(p.id) ? 'on' : ''}" data-act="like" data-id="${id}" data-p="${p.id}" style="--pc:${p.color}">👍 ${esc(p.name)}</button>`).join('')}</div></div>
      <div class="r-cols">
        <section><h3>🧺 Ingredients</h3>
          <ul class="ingredients">${(r.ingredients || []).map((ing, i) => `<li><label><input type="checkbox" checked data-ing="${i}"/> <span>${esc(ing)}</span></label></li>`).join('')}</ul>
          <button class="btn sm primary" data-act="add-ings" data-id="${id}">🛒 Add checked to groceries</button>
        </section>
        <section><h3>👩‍🍳 Steps</h3><ol class="steps">${(r.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>
      </div>
      ${r.picky?.length ? `<section class="picky"><h3>🧒 Picky-eater tricks</h3><ul>${r.picky.map(s => `<li>${esc(s)}</li>`).join('')}</ul></section>` : ''}
      ${r.grownUp ? `<section class="grownup"><h3>🌶️ Make it grown-up</h3><p>${esc(r.grownUp)}</p></section>` : ''}
    </div>
    <div class="modal-foot">
      ${r.custom ? `<button class="btn ghost danger" data-act="del-recipe" data-id="${id}">Delete</button><button class="btn ghost" data-act="edit-recipe" data-id="${id}">Edit</button>` : '<span></span>'}
      <div class="row"><input class="input sm" type="date" id="plan-date" value="${L.today()}" aria-label="Plan date"/><button class="btn primary" data-act="plan-recipe" data-id="${id}">Plan dinner</button></div>
    </div>
  </div>`, { wide: true });
}
function planDay(date) {
  const p = store.get('mp_' + date);
  const opts = allRecipes().filter(r => r.meal === 'Dinner' || r.meal === 'Lunch').sort((a, b) => a.name.localeCompare(b.name));
  openModal(`<form class="editor" data-submit="save-plan" data-date="${date}">
    <div class="modal-head"><h2>Dinner · ${esc(L.fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2><button type="button" class="icon-btn" data-act="close">✕</button></div>
    <div class="modal-body">
      <label class="field"><span class="label">Pick a recipe</span><select class="select" name="recipe"><option value="">—</option>${CUISINES.concat([{ id: 'family', name: 'Our recipes', flag: '🏡' }]).map(c => { const rs = opts.filter(r => r.cuisine === c.id); return rs.length ? `<optgroup label="${c.flag} ${esc(c.name)}">${rs.map(r => `<option value="${r.id}" ${p?.recipeId === r.id ? 'selected' : ''}>${r.emoji} ${esc(r.name)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label>
      <label class="field"><span class="label">…or just type it</span><input class="input" name="text" placeholder="Leftovers, pizza night out, BBQ at Grandma's" value="${esc(p?.text || '')}" maxlength="80"/></label>
    </div>
    <div class="modal-foot">${p ? '<button type="button" class="btn ghost danger" data-act="clear-plan" data-date="' + date + '">Clear</button>' : '<span></span>'}<button class="btn primary">Save</button></div>
  </form>`);
}
function recipeForm(r = null) {
  r = r || { id: '', name: '', cuisine: 'family', meal: 'Dinner', emoji: '🍲', time: 30, level: 'Easy', ingredients: [], steps: [], picky: [], grownUp: '' };
  openModal(`<form class="editor" data-submit="save-recipe" data-id="${r.id}">
    <div class="modal-head"><h2>${r.id ? 'Edit' : 'Add'} our recipe</h2><button type="button" class="icon-btn" data-act="close">✕</button></div>
    <div class="modal-body">
      <div class="grid2"><label class="field"><span class="label">Name</span><input class="input" name="name" required value="${esc(r.name)}" maxlength="80"/></label>
      <label class="field"><span class="label">Emoji</span><input class="input" name="emoji" value="${esc(r.emoji)}" maxlength="4"/></label></div>
      <div class="grid3"><label class="field"><span class="label">Cuisine</span><select class="select" name="cuisine"><option value="family">🏡 Family</option>${CUISINES.map(c => `<option value="${c.id}" ${r.cuisine === c.id ? 'selected' : ''}>${c.flag} ${c.name}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Meal</span><select class="select" name="meal">${MEAL_TYPES.map(m => `<option ${r.meal === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Minutes</span><input class="input" name="time" type="number" min="1" max="600" value="${r.time}"/></label></div>
      <label class="field"><span class="label">Ingredients (one per line)</span><textarea class="input" name="ingredients" rows="5">${esc((r.ingredients || []).join('\n'))}</textarea></label>
      <label class="field"><span class="label">Steps (one per line)</span><textarea class="input" name="steps" rows="5">${esc((r.steps || []).join('\n'))}</textarea></label>
      <label class="field"><span class="label">Picky-eater tricks (one per line)</span><textarea class="input" name="picky" rows="3">${esc((r.picky || []).join('\n'))}</textarea></label>
    </div>
    <div class="modal-foot"><span></span><button class="btn primary">Save recipe</button></div>
  </form>`);
}

/* =====================================================================
   PERSON PAGE
   ===================================================================== */
function viewPerson(id) {
  const p = personById(id);
  if (!p) return `<div class="empty"><span>🤷</span><p>Person not found.</p><a class="btn" href="#home">Home</a></div>`;
  const t = L.today();
  const occs = occBetween(t, L.addDays(t, 21), { filter: [p.id], cat: '' }).filter(o => !isEveryone(o.ev) || true);
  const groups = {}; occs.forEach(o => (groups[o.date] ||= []).push(o));
  const needs = store.list('need').filter(n => n.for === p.id && !n.done);
  const likes = allRecipes().filter(r => (recipeMeta(r.id).likes || []).includes(p.id));
  const weekOcc = occs.filter(o => o.date <= L.addDays(t, 6) && !isEveryone(o.ev));
  const mix = {}; weekOcc.forEach(o => mix[o.ev.category] = (mix[o.ev.category] || 0) + 1);
  return `
  <section class="person-hero" style="--pc:${p.color};--pi:${L.ink(p.color)}">
    ${avatar(p, 'xl')}
    <div><h1>${esc(p.name)}</h1><p>${weekOcc.length} activit${weekOcc.length === 1 ? 'y' : 'ies'} this week${needs.length ? ` · ${needs.length} need${needs.length > 1 ? 's' : ''}` : ''}</p>
      <div class="mix light">${Object.entries(mix).map(([c, n]) => `<span>${L.catById(c).icon} ${n}</span>`).join('')}</div></div>
    <div class="ph-actions"><button class="btn" data-act="new-event" data-person="${p.id}">＋ Event for ${esc(p.name)}</button><button class="btn" data-act="person-cal" data-id="${p.id}">📅 ${esc(p.name)}'s calendar</button></div>
  </section>
  <div class="dash">
    <section class="card pad d-upcoming wide2"><div class="sec-head"><h2>Next 3 weeks</h2></div>
      ${Object.keys(groups).length ? Object.keys(groups).sort().map(d => `<div class="day-group"><div class="dg-head"><b>${esc(L.relDay(d))}</b><span class="muted tiny">${L.fmtDate(d, { month: 'short', day: 'numeric' })}</span></div>${groups[d].map(o => evRow(o, { compact: true })).join('')}</div>`).join('') : '<p class="muted">Nothing scheduled.</p>'}
    </section>
    <section class="card pad"><div class="sec-head"><h2>🛒 ${esc(p.name)} needs</h2><button class="link" data-act="goto-needs-for" data-id="${p.id}">All →</button></div>
      <form class="quick-add" data-submit="person-need" data-id="${p.id}"><input name="text" placeholder="e.g. new cleats size 4" aria-label="Add need"/><button class="btn sm primary">Add</button></form>
      ${needs.length ? needs.map(n => `<div class="need mini"><button class="check" data-act="toggle-need" data-id="${n.id}"></button><span>${esc(n.text)}${n.qty ? ` × ${esc(n.qty)}` : ''} <span class="muted tiny">${L.NEED_LISTS.find(l => l.id === n.list)?.icon || ''}</span></span></div>`).join('') : '<p class="muted tiny">Nothing needed.</p>'}
    </section>
    <section class="card pad"><div class="sec-head"><h2>📏 Sizes</h2></div>
      <div class="size-list">${SIZE_FIELDS.map(([k, label]) => `<label><span>${label}</span><input class="input sm" value="${esc(p.sizes?.[k] || '')}" data-change="size" data-person="${p.id}" data-k="${k}" placeholder="—" maxlength="24"/></label>`).join('')}</div>
    </section>
    <section class="card pad"><div class="sec-head"><h2>😋 Foods ${esc(p.name)} likes</h2><a class="link" href="#meals">Recipes →</a></div>
      ${likes.length ? `<div class="mini-recipes">${likes.slice(0, 8).map(r => `<button class="mini-recipe" data-act="open-recipe" data-id="${r.id}"><span>${r.emoji}</span><b>${esc(r.name)}</b></button>`).join('')}</div>` : `<p class="muted tiny">Open a recipe and tap 👍 ${esc(p.name)} to build a list of safe foods.</p>`}
      <label class="field"><span class="label">Food notes (likes / won't eat)</span><textarea class="input" rows="2" data-change="person-food" data-id="${p.id}" placeholder="Loves noodles, no sauce touching, hates mushrooms…" maxlength="400">${esc(p.food || '')}</textarea></label>
    </section>
  </div>`;
}

/* =====================================================================
   SETTINGS
   ===================================================================== */
function viewSettings() {
  const s = settings();
  const l = syncLabel();
  return `
  <section class="card pad">
    <div class="sec-head"><h2>🎨 Theme</h2><span class="muted tiny">This device</span></div>
    <div class="theme-grid">${L.THEMES.map(t => `<button class="theme-card ${prefs.theme === t.id ? 'on' : ''}" data-act="set-theme" data-id="${t.id}"><span class="theme-sw" style="background:linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)"></span>${t.name}</button>`).join('')}</div>
  </section>

  <section class="card pad">
    <div class="sec-head"><h2>📱 This device</h2></div>
    <div class="grid2">
      <label class="field"><span class="label">Who's using it?</span><select class="select" data-change="set-me"><option value="">Not set</option>${people().map(p => `<option value="${p.id}" ${prefs.me === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Week starts on</span><select class="select" data-change="week-start"><option value="0" ${prefs.weekStart === 0 ? 'selected' : ''}>Sunday</option><option value="1" ${prefs.weekStart === 1 ? 'selected' : ''}>Monday</option></select></label>
      <label class="field"><span class="label">Day view starts at</span><select class="select" data-change="day-start">${[5, 6, 7, 8, 9].map(h => `<option value="${h}" ${prefs.dayStart === h ? 'selected' : ''}>${L.fmtTime(L.fromMin(h * 60))}</option>`).join('')}</select></label>
      <label class="field"><span class="label">&nbsp;</span><span class="toggle"><input type="checkbox" data-change="weather-on" ${prefs.weather ? 'checked' : ''}/><span></span>Show weather</span></label>
    </div>
  </section>

  <section class="card pad">
    <div class="sec-head"><h2>👨‍👩‍👦 Family</h2><span class="muted tiny">Shared with everyone</span></div>
    <label class="field"><span class="label">Family name</span><input class="input" value="${esc(s.familyName)}" data-change="family-name" maxlength="40"/></label>
    <div class="people-edit">${s.people.map((p, i) => `
      <div class="pe-row" style="--pc:${p.color}">
        ${avatar(p)}
        <input class="input sm" value="${esc(p.name)}" data-change="person-name" data-i="${i}" maxlength="20" aria-label="Name"/>
        <input class="input sm emoji-in" value="${esc(p.emoji || '')}" data-change="person-emoji" data-i="${i}" maxlength="4" aria-label="Emoji"/>
        <div class="palette">${L.PALETTE.map(c => `<button class="sw ${p.color === c ? 'on' : ''}" style="background:${c}" data-act="person-color" data-i="${i}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}<label class="sw custom" title="Custom colour"><input type="color" value="${p.color}" data-change="person-color-custom" data-i="${i}"/></label></div>
        ${s.people.length > 1 ? `<button class="icon-btn xs" data-act="person-remove" data-i="${i}" aria-label="Remove">✕</button>` : ''}
      </div>`).join('')}</div>
    <button class="btn sm" data-act="person-add">＋ Add family member</button>
    <label class="toggle"><input type="checkbox" data-change="holidays" ${s.showHolidays ? 'checked' : ''}/><span></span>Show Ontario holidays & special days</label>
    <form class="field" data-submit="set-location"><span class="label">Weather location · now: ${esc(s.location?.name || '—')}</span><div class="row"><input class="input" name="q" placeholder="City (e.g. Ajax, Whitby, Toronto)"/><button class="btn">Set</button></div></form>
  </section>

  <section class="card pad">
    <div class="sec-head"><h2>🔄 Sharing & sync</h2></div>
    <p><span class="sync-pill ${l.cls}"><i></i>${esc(l.text)}</span> ${store.statusMessage ? `<span class="muted tiny">${esc(store.statusMessage)}</span>` : ''}</p>
    ${store.isShared ? `<p class="muted">This calendar is shared. Anyone with the website link and the family PIN sees the same events, lists and notes. Changes from other phones appear within about ${CONFIG.SYNC_SECONDS || 25} seconds.</p>`
      : `<div class="note-box">🧪 <b>Preview mode.</b> Everything is saved on this device only. To share across phones, follow <b>SETUP.md</b> (about 10 minutes, free) and paste your Google Apps Script link into <code>config.js</code> — or below to test on this device.</div>`}
    <div class="row wrap">
      <button class="btn" data-act="sync-now">Sync now</button>
      <button class="btn" data-act="lock">🔒 Lock this device</button>
      ${!store.isShared ? `<button class="btn" data-act="change-preview-pin">Change preview PIN</button>` : ''}
    </div>
    <details class="adv"><summary>Advanced: server link for this device</summary>
      <form class="row" data-submit="set-api"><input class="input" name="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(ls.get('fh.apiUrl.v1', ''))}"/><button class="btn">Save</button></form>
      <p class="tiny muted">Normally set once in config.js for everyone. This override only affects this browser.</p>
    </details>
  </section>

  <section class="card pad">
    <div class="sec-head"><h2>💾 Backup</h2></div>
    <p class="muted tiny">${store.isShared ? 'Your data also lives in your Google Sheet. ' : ''}Download a copy any time, or restore one.</p>
    <div class="row wrap"><button class="btn" data-act="export">⬇️ Export backup</button><label class="btn">⬆️ Import backup<input type="file" accept="application/json,.json" data-change="import" hidden/></label>
    <button class="btn ghost" data-act="load-sample">✨ Add sample events</button></div>
  </section>
  <p class="center tiny muted">Family Hub · made with ❤️ for ${esc(s.familyName)} · keyboard: N new · T today · ← → move · M/W/D views</p>`;
}

/* =====================================================================
   Sample data (for trying it out)
   ===================================================================== */
function loadSample() {
  const t = L.today(); const w = L.startOfWeek(t, 0);
  const P = people().map(p => p.id);
  const [a, b, c, d] = [P[0], P[1] || P[0], P[2] || P[0], P[3] || P[0]];
  const until = L.addDays(t, 70);
  const who = me()?.name || '';
  const evs = [
    { title: 'Volleyball practice', category: 'volleyball', people: [c], date: L.addDays(w, 2), start: '18:00', end: '19:30', location: 'Community centre gym', repeat: { freq: 'weekly', interval: 1, days: [2, 4], until }, dropoff: b, pickup: a, bring: 'Knee pads, court shoes, water bottle' },
    { title: 'Soccer game', category: 'soccer', people: [d], date: L.addDays(w, 6), start: '10:00', end: '11:00', location: 'Kinsmen Park field 3', repeat: { freq: 'weekly', interval: 1, days: [6], until }, bring: 'Cleats, shin pads, red jersey', dropoff: a },
    { title: 'Baseball', category: 'baseball', people: [c, d], date: L.addDays(w, 3), start: '17:30', end: '19:00', location: 'Diamond 2', repeat: { freq: 'weekly', interval: 1, days: [3], until }, pickup: b },
    { title: 'Ball hockey', category: 'ballhockey', people: [a], date: L.addDays(w, 1), start: '20:00', end: '21:00', location: 'Rec centre rink', repeat: { freq: 'weekly', interval: 1, days: [1] } },
    { title: 'School', category: 'school', people: [c, d], date: L.addDays(w, 1), start: '08:45', end: '15:15', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] } },
    { title: 'Work', category: 'work', people: [a], date: L.addDays(w, 1), start: '07:00', end: '15:30', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] } },
    { title: 'Work', category: 'work', people: [b], date: L.addDays(w, 1), start: '09:00', end: '17:00', repeat: { freq: 'weekly', interval: 1, days: [1, 3, 5] } },
    { title: 'Dentist', category: 'appointment', people: [d], date: L.addDays(t, 4), start: '16:00', end: '16:45', location: 'Main St. Dental' },
    { title: 'Family movie night', category: 'family', people: [], date: L.addDays(w, 5), start: '19:00', end: '21:00', repeat: { freq: 'weekly', interval: 1, days: [5] } },
    { title: 'Volleyball tournament', category: 'volleyball', people: [c], date: L.addDays(t, 16), endDate: L.addDays(t, 17), allDay: true, location: 'Oshawa', countdown: true, bring: 'Knee pads, snacks, 2 jerseys' },
    { title: "Grandma's birthday", category: 'birthday', people: [], date: L.addDays(t, 23), allDay: true, repeat: { freq: 'yearly', interval: 1 }, bring: 'Card, flowers' },
  ];
  evs.forEach(e => store.put('event', { id: '', allDay: false, endDate: '', notes: '', exdates: [], dropoff: '', pickup: '', bring: '', location: '', countdown: false, repeat: { freq: 'none' }, createdBy: who, ...e }));
  [['Milk', '2', 'groceries'], ['Bananas', '', 'groceries'], ['Chicken thighs', '1 kg', 'groceries'], ['Rice', '', 'groceries']].forEach(([text, qty, list]) => addNeed({ text, qty, list }));
  addNeed({ text: 'Soccer socks', list: 'sports', forP: d, urgent: true });
  addNeed({ text: 'Winter jacket', list: 'clothes', forP: c });
  store.put('note', { id: '', text: 'Welcome to the family calendar! Tap ＋ to add your first event.', by: prefs.me || a, at: Date.now(), pinned: true });
  store.put('mealplan', { id: 'mp_' + t, date: t, recipeId: 'cn-honeygarlic' });
  toast('Sample events added');
  renderPage();
}

/* =====================================================================
   Actions (event delegation)
   ===================================================================== */
const actions = {
  close: () => closeModal(),
  overlay: (el, e) => { if (e.target === el) closeModal(); },
  undo: () => { const u = toast.undo; toast.undo = null; $('#toast').className = ''; if (u) { u(); renderPage(); } },
  'confirm-pick': el => confirmBox.resolve && confirmBox.resolve(Number(el.dataset.i)),
  'pin-key': el => { const k = el.dataset.k; if (k === 'back') pinEntry = pinEntry.slice(0, -1); else if (pinEntry.length < 12) pinEntry += k; pinMsg = ''; $('.pin-msg').textContent = ''; updatePinDots(); },
  'set-me': el => { prefs.me = el.dataset.id; savePrefs(); store.by = me()?.name || ''; closeModal(); renderPage(); },
  'cycle-theme': () => { const ids = L.THEMES.map(t => t.id).filter(t => t !== 'auto'); const cur = document.documentElement.dataset.theme; prefs.theme = ids[(ids.indexOf(cur) + 1) % ids.length]; savePrefs(); applyTheme(); toast('Theme: ' + L.THEMES.find(t => t.id === prefs.theme).name); if (route().page === 'settings') renderPage(); },
  'set-theme': el => { prefs.theme = el.dataset.id; savePrefs(); applyTheme(); renderPage(); },
  'sync-now': () => { if (!store.isShared) return toast('Preview mode — nothing to sync yet'); store.sync(true); toast('Syncing…'); },
  lock: () => { store.lock(); renderLock(); },
  'new-event': el => { closeModal(true); newEvent(el.dataset.date, { person: el.dataset.person }); },
  'open-event': (el, e) => { e.stopPropagation(); openEvent(el.dataset.id, el.dataset.date); },
  'filter-person': el => { const id = el.dataset.id; if (!id) prefs.filter = []; else prefs.filter = prefs.filter.includes(id) ? prefs.filter.filter(x => x !== id) : [...prefs.filter, id]; if (prefs.filter.length >= people().length) prefs.filter = []; savePrefs(); renderPage(); },
  'filter-cat-go': el => { prefs.cat = el.dataset.cat; prefs.view = 'list'; prefs.cursor = L.today(); savePrefs(); go('calendar'); },
  'goto-day': (el, e) => { e.stopPropagation(); prefs.cursor = el.dataset.date; prefs.view = 'day'; savePrefs(); go('calendar'); },
  'goto-view': el => { prefs.view = el.dataset.view; prefs.cursor = L.today(); savePrefs(); go('calendar'); },
  'goto-needs': el => { prefs.needsList = el.dataset.list; prefs.needsFor = ''; savePrefs(); go('needs'); },
  'goto-needs-for': el => { prefs.needsList = 'all'; prefs.needsFor = el.dataset.id; savePrefs(); go('needs'); },
  'person-cal': el => { prefs.filter = [el.dataset.id]; prefs.view = 'week'; savePrefs(); go('calendar'); },
  'cal-prev': () => calShift(-1), 'cal-next': () => calShift(1),
  'cal-today': () => { prefs.cursor = L.today(); savePrefs(); renderPage(true); },
  'set-view': el => { prefs.view = el.dataset.view; savePrefs(); renderPage(true); },
  'select-day': el => {
    const d = el.dataset.date;
    if (prefs.cursor === d && isWide()) { newEvent(d); return; }
    prefs.cursor = d; savePrefs(); renderPage();
    if (!isWide()) $('.sel-day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  slot: (el, e) => {
    if (e.target !== el && !e.target.classList.contains('tg-slot')) return;
    const rect = el.getBoundingClientRect();
    const mins = Number(el.dataset.h0) * 60 + Math.floor((e.clientY - rect.top) / HOUR_PX * 2) * 30;
    newEvent(el.dataset.date, { start: L.fromMin(Math.min(mins, 23 * 60)), person: el.dataset.person || undefined });
  },
  print: () => window.print(),
  'share-range': () => {
    const view = prefs.view; const from = view === 'day' ? prefs.cursor : L.startOfWeek(prefs.cursor, prefs.weekStart); const to = view === 'day' ? from : L.addDays(from, 6);
    const occs = occBetween(from, to); const g = {}; occs.forEach(o => (g[o.date] ||= []).push(o));
    const text = `${settings().familyName} — ${calTitle()}\n\n` + (Object.keys(g).sort().map(d => `${L.fmtDate(d)}\n` + g[d].map(o => `  ${L.catById(o.ev.category).icon} ${o.allDay ? 'All day' : L.fmtRange(o.ev)} ${o.ev.title} (${isEveryone(o.ev) ? 'Everyone' : evPeople(o.ev).map(p => p.name).join(', ')})${o.ev.location ? ' @ ' + o.ev.location : ''}`).join('\n')).join('\n\n') || 'Nothing planned!');
    if (navigator.share) navigator.share({ text }).catch(() => {}); else navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard'));
  },
  // editor
  'ed-cat': el => { const prev = L.catById(draft.ev.category); const next = L.catById(el.dataset.id); if (!draft.ev.bring || draft.ev.bring === prev.bring) draft.ev.bring = next.bring; if (!draft.ev.title || draft.ev.title === prev.name) draft.ev.title = ''; draft.ev.category = next.id; if (next.id === 'birthday' && draft.isNew) { draft.ev.allDay = true; draft.ev.repeat = { freq: 'yearly', interval: 1 }; } refreshEditor(); },
  'ed-who': el => { const id = el.dataset.id; const ev = draft.ev; if (!id) ev.people = []; else ev.people = ev.people.includes(id) ? ev.people.filter(x => x !== id) : [...ev.people, id]; if (ev.people.length >= people().length) ev.people = []; refreshEditor(); },
  'ed-wd': el => { const r = draft.ev.repeat; const d = Number(el.dataset.d); const days = r.days && r.days.length ? [...r.days] : [L.dow(draft.ev.date)]; r.days = days.includes(d) ? days.filter(x => x !== d) : [...days, d]; if (!r.days.length) r.days = [d]; refreshEditor(); },
  'del-event': () => deleteEvent(),
  'dup-event': () => { draft = { ev: { ...structuredClone(draft.ev), id: '', exdates: [] }, occDate: draft.occDate, isNew: true, onlyThis: false }; renderEditor(); toast('Copy — change what you need and save'); },
  'ics-event': () => downloadFile((draft.ev.title || 'event').replace(/[^\w]+/g, '-') + '.ics', icsFor(draft.ev), 'text/calendar'),
  // needs
  'needs-list': el => { prefs.needsList = el.dataset.list; savePrefs(); renderPage(); },
  'needs-for': el => { const id = el.dataset.id; prefs.needsFor = prefs.needsFor === id ? '' : id; savePrefs(); renderPage(); },
  'toggle-need': el => { const n = store.get(el.dataset.id); if (!n) return; store.put('need', { ...n, done: !n.done, doneAt: Date.now() }); renderPage(); },
  'urgent-need': el => { const n = store.get(el.dataset.id); if (n) { store.put('need', { ...n, urgent: !n.urgent }); renderPage(); } },
  'del-need': el => { const prev = store.remove(el.dataset.id); renderPage(); if (prev) toast('Removed', () => store.put('need', prev)); },
  'edit-need': el => { const n = store.get(el.dataset.id); if (!n) return; openModal(`<form class="editor" data-submit="save-need" data-id="${n.id}"><div class="modal-head"><h2>Edit item</h2><button type="button" class="icon-btn" data-act="close">✕</button></div><div class="modal-body">
      <label class="field"><span class="label">Item</span><input class="input" name="text" value="${esc(n.text)}" required maxlength="120"/></label>
      <div class="grid3"><label class="field"><span class="label">Qty</span><input class="input" name="qty" value="${esc(n.qty || '')}" maxlength="12"/></label>
      <label class="field"><span class="label">List</span><select class="select" name="list">${L.NEED_LISTS.map(l => `<option value="${l.id}" ${n.list === l.id ? 'selected' : ''}>${l.icon} ${esc(l.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="label">For</span><select class="select" name="for"><option value="">Anyone</option>${people().map(p => `<option value="${p.id}" ${n.for === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
      <label class="field"><span class="label">Note</span><input class="input" name="note" value="${esc(n.note || '')}" placeholder="Brand, size, store…" maxlength="160"/></label>
      </div><div class="modal-foot"><span></span><button class="btn primary">Save</button></div></form>`); },
  'clear-done': (el, e) => { e.preventDefault(); const done = store.list('need').filter(n => n.done && (prefs.needsList === 'all' || n.list === prefs.needsList)); done.forEach(n => store.remove(n.id)); renderPage(); toast(`Cleared ${done.length}`, () => done.forEach(n => store.put('need', n))); },
  'quick-need': () => { prefs.needsList = 'groceries'; savePrefs(); go('needs'); setTimeout(() => $('.add-need input[name=text]')?.focus(), 100); },
  // notes
  'new-note': () => openModal(`<form class="editor" data-submit="save-note"><div class="modal-head"><h2>📝 Fridge note</h2><button type="button" class="icon-btn" data-act="close">✕</button></div><div class="modal-body"><textarea class="input" name="text" rows="4" required maxlength="400" placeholder="Practice moved to 6pm · Pizza Friday! · Library books due" autofocus></textarea></div><div class="modal-foot"><span></span><button class="btn primary">Post note</button></div></form>`),
  'pin-note': el => { const n = store.get(el.dataset.id); if (n) { store.put('note', { ...n, pinned: !n.pinned }); renderPage(); } },
  'del-note': el => { const prev = store.remove(el.dataset.id); renderPage(); if (prev) toast('Note removed', () => store.put('note', prev)); },
  // meals
  'open-recipe': el => openRecipe(el.dataset.id),
  surprise: () => { const pool = allRecipes().filter(r => r.meal === 'Dinner'); openRecipe(pool[Math.floor(Math.random() * pool.length)].id); },
  'meal-cuisine': el => { prefs.mealCuisine = el.dataset.id; savePrefs(); renderPage(); },
  'meal-type': el => { prefs.mealType = el.dataset.id; savePrefs(); renderPage(); },
  'meal-fav': () => { prefs.mealFav = !prefs.mealFav; savePrefs(); renderPage(); },
  like: el => { const m = recipeMeta(el.dataset.id); const p = el.dataset.p; const likes = (m.likes || []).includes(p) ? m.likes.filter(x => x !== p) : [...(m.likes || []), p]; store.put('recipeMeta', { ...m, likes }); el.classList.toggle('on'); },
  'add-ings': el => { const r = recipeById(el.dataset.id); const idx = $$('.ingredients input:checked').map(i => Number(i.dataset.ing)); idx.forEach(i => addNeed({ text: r.ingredients[i], list: 'groceries' })); toast(`Added ${idx.length} item${idx.length === 1 ? '' : 's'} to groceries`); },
  'plan-recipe': el => { const d = $('#plan-date')?.value || L.today(); store.put('mealplan', { id: 'mp_' + d, date: d, recipeId: el.dataset.id }); closeModal(); toast(`Planned for ${L.relDay(d)}`); renderPage(); },
  'plan-day': el => planDay(el.dataset.date),
  'clear-plan': el => { store.remove('mp_' + el.dataset.date); closeModal(); renderPage(); },
  'new-recipe': () => recipeForm(),
  'edit-recipe': el => recipeForm(store.get(el.dataset.id)),
  'del-recipe': el => { const prev = store.remove(el.dataset.id); closeModal(); renderPage(); toast('Recipe deleted', () => store.put('recipe', prev)); },
  // settings
  'person-color': el => { const s = settings(); const ps = structuredClone(s.people); ps[el.dataset.i].color = el.dataset.c; saveSettings({ people: ps }); renderShellState(); renderPage(); },
  'person-add': () => { const s = settings(); const ps = structuredClone(s.people); const used = new Set(ps.map(p => p.color)); ps.push({ id: uid('p'), name: 'New person', emoji: '🙂', color: L.PALETTE.find(c => !used.has(c)) || '#64748b' }); saveSettings({ people: ps }); renderShellState(); renderPage(); },
  'person-remove': async el => { const s = settings(); const p = s.people[el.dataset.i]; const ok = await confirmBox(`Remove ${p.name}?`, 'Their events stay on the calendar for everyone else.', [{ label: 'Remove', value: 'yes', kind: 'danger' }]); if (!ok) return; saveSettings({ people: s.people.filter((_, i) => i !== Number(el.dataset.i)) }); renderShellState(); renderPage(); },
  'change-preview-pin': () => openModal(`<form class="editor" data-submit="preview-pin"><div class="modal-head"><h2>Preview PIN</h2><button type="button" class="icon-btn" data-act="close">✕</button></div><div class="modal-body"><label class="field"><span class="label">New PIN (3–12 digits)</span><input class="input" name="pin" inputmode="numeric" pattern="[0-9]{3,12}" required autofocus/></label><p class="tiny muted">Only for preview mode. Your shared PIN is set in Google Apps Script.</p></div><div class="modal-foot"><span></span><button class="btn primary">Save</button></div></form>`),
  export: () => downloadFile(`family-hub-backup-${L.today()}.json`, JSON.stringify(store.exportAll(), null, 2), 'application/json'),
  'load-sample': () => loadSample(),
  'weather-detail': () => {
    if (!weather) return;
    const days = Object.entries(weather.days).slice(0, 7);
    openModal(`<div><div class="modal-head"><h2>${esc(settings().location?.name || 'Weather')}</h2><button class="icon-btn" data-act="close">✕</button></div><div class="modal-body"><div class="wx-week">${days.map(([d, w]) => { const i = L.weatherInfo(w.code); return `<div class="wx-day"><b>${esc(L.relDay(d).slice(0, 9))}</b><span class="wx-ico">${i.icon}</span><span>${w.hi}° / ${w.lo}°</span><small class="muted">${esc(i.label)}${w.pop ? ` · ${w.pop}%` : ''}</small></div>`; }).join('')}</div><p class="tiny muted">Forecast by Open-Meteo. Outdoor events (soccer, baseball, ball hockey) show rain chances on the calendar.</p></div></div>`);
  },
};

const changes = {
  'filter-cat': el => { prefs.cat = el.value; savePrefs(); renderPage(); },
  split: el => { prefs.split = el.checked; savePrefs(); renderPage(); },
  'ed-field': el => { draft.ev[el.dataset.field] = el.value; if (['dropoff', 'pickup'].includes(el.dataset.field)) return; if (el.dataset.field === 'end') refreshEditor(); },
  'ed-date': el => { if (!el.value) return; if (draft.onlyThis) { draft.onlyDate = el.value; } else { const ev = draft.ev; if (ev.endDate) ev.endDate = L.addDays(el.value, L.diffDays(ev.date, ev.endDate)); ev.date = el.value; if (ev.repeat?.freq === 'weekly' && ev.repeat.days?.length === 1) ev.repeat.days = [L.dow(el.value)]; } refreshEditor(); },
  'ed-start': el => { const ev = draft.ev; const dur = (L.toMin(ev.end) ?? L.toMin(ev.start) + 60) - (L.toMin(ev.start) ?? 0); ev.start = el.value; if (el.value) ev.end = L.fromMin(Math.min(1439, L.toMin(el.value) + (dur > 0 ? dur : 60))); refreshEditor(); },
  'ed-allday': el => { draft.ev.allDay = el.checked; if (!el.checked && !draft.ev.start) { draft.ev.start = '18:00'; draft.ev.end = '19:00'; } refreshEditor(); },
  'ed-freq': el => { draft.ev.repeat = { ...(draft.ev.repeat || {}), freq: el.value, interval: draft.ev.repeat?.interval || 1, days: el.value === 'weekly' ? [L.dow(draft.ev.date)] : [] }; refreshEditor(); },
  'ed-interval': el => { draft.ev.repeat.interval = Number(el.value); },
  'ed-until': el => { draft.ev.repeat.until = el.value; },
  'ed-only': el => { draft.onlyThis = el.checked; draft.onlyDate = draft.occDate; refreshEditor(); },
  'ed-countdown': el => { draft.ev.countdown = el.checked; },
  size: el => { const ps = structuredClone(settings().people); const p = ps.find(x => x.id === el.dataset.person); if (!p) return; p.sizes = { ...(p.sizes || {}), [el.dataset.k]: el.value.trim() }; saveSettings({ people: ps }); toast('Size saved'); },
  'person-food': el => { const ps = structuredClone(settings().people); const p = ps.find(x => x.id === el.dataset.id); if (!p) return; p.food = el.value.trim(); saveSettings({ people: ps }); toast('Saved'); },
  'set-me': el => { prefs.me = el.value; savePrefs(); store.by = me()?.name || ''; toast('Saved'); },
  'week-start': el => { prefs.weekStart = Number(el.value); savePrefs(); },
  'day-start': el => { prefs.dayStart = Number(el.value); savePrefs(); },
  'weather-on': el => { prefs.weather = el.checked; savePrefs(); if (el.checked) loadWeather(true); },
  'family-name': el => { saveSettings({ familyName: el.value.trim() || 'Family Hub' }); renderShellState(); toast('Saved'); },
  'person-name': el => { const ps = structuredClone(settings().people); ps[el.dataset.i].name = el.value.trim() || ps[el.dataset.i].name; saveSettings({ people: ps }); renderShellState(); renderPage(); },
  'person-emoji': el => { const ps = structuredClone(settings().people); ps[el.dataset.i].emoji = el.value.trim(); saveSettings({ people: ps }); renderShellState(); renderPage(); },
  'person-color-custom': el => { const ps = structuredClone(settings().people); ps[el.dataset.i].color = el.value; saveSettings({ people: ps }); renderShellState(); renderPage(); },
  holidays: el => { saveSettings({ showHolidays: el.checked }); },
  import: async el => { const f = el.files[0]; if (!f) return; try { const n = store.importAll(JSON.parse(await f.text())); toast(`Imported ${n} items`); renderShellState(); renderPage(); } catch (err) { toast('Import failed: ' + err.message); } },
};
const inputs = {
  'ed-field': el => { draft.ev[el.dataset.field] = el.value; },
  'list-search': el => { listSearch = el.value; clearTimeout(inputs.t); inputs.t = setTimeout(() => { const pos = el.selectionStart; renderPage(); const n = $('[data-input="list-search"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); },
  'meal-search': el => { prefs.mealSearch = el.value; clearTimeout(inputs.t); inputs.t = setTimeout(() => { savePrefs(); const pos = el.selectionStart; renderPage(); const n = $('[data-input="meal-search"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); },
};
const submits = {
  unlock: () => doUnlock(),
  'preview-pin': (f) => { const pin = String(new FormData(f).get('pin') || ''); if (!/^\d{3,12}$/.test(pin)) return toast('3–12 digits please'); store.setPreviewPin(pin); closeModal(); toast('Preview PIN changed'); },
  'save-event': () => saveEvent(),
  'add-need': (f) => { const fd = new FormData(f); const list = prefs.needsList === 'all' ? fd.get('list') : prefs.needsList; if (addNeed({ text: fd.get('text'), qty: fd.get('qty'), list, forP: fd.get('for'), urgent: fd.get('urgent') })) { renderPage(); $('.add-need input[name=text]')?.focus(); } },
  'dash-need': (f) => { const fd = new FormData(f); if (addNeed({ text: fd.get('text'), list: 'groceries' })) { toast('Added to groceries'); renderPage(); } },
  'person-need': (f) => { const fd = new FormData(f); const text = String(fd.get('text') || ''); const list = /shirt|pant|jacket|shoe|sock|coat|boot|hat|mitt|glove|dress|short|hoodie|clothes/i.test(text) ? 'clothes' : /cleat|pad|stick|glove|bat|helmet|jersey|ball/i.test(text) ? 'sports' : 'other'; if (addNeed({ text, list, forP: f.dataset.id })) { toast('Added'); renderPage(); } },
  'save-need': (f) => { const fd = new FormData(f); const n = store.get(f.dataset.id); if (!n) return closeModal(); store.put('need', { ...n, text: String(fd.get('text')).trim(), qty: String(fd.get('qty')).trim(), list: fd.get('list'), for: fd.get('for'), note: String(fd.get('note')).trim() }); closeModal(); renderPage(); },
  'save-note': (f) => { const text = String(new FormData(f).get('text') || '').trim(); if (!text) return; store.put('note', { id: '', text, by: prefs.me, at: Date.now(), pinned: false }); closeModal(); renderPage(); },
  'save-plan': (f) => { const fd = new FormData(f); const d = f.dataset.date; const recipeId = fd.get('recipe'); const text = String(fd.get('text') || '').trim(); if (!recipeId && !text) store.remove('mp_' + d); else store.put('mealplan', { id: 'mp_' + d, date: d, recipeId, text: recipeId ? '' : text }); closeModal(); renderPage(); },
  'save-recipe': (f) => { const fd = new FormData(f); const lines = k => String(fd.get(k) || '').split('\n').map(s => s.trim()).filter(Boolean); store.put('recipe', { id: f.dataset.id || '', name: String(fd.get('name')).trim(), emoji: String(fd.get('emoji')).trim() || '🍲', cuisine: fd.get('cuisine'), meal: fd.get('meal'), time: Number(fd.get('time')) || 30, level: 'Easy', ingredients: lines('ingredients'), steps: lines('steps'), picky: lines('picky'), by: me()?.name || '' }); closeModal(); toast('Recipe saved'); prefs.mealCuisine = 'all'; renderPage(); },
  'set-location': async (f) => {
    const q = String(new FormData(f).get('q') || '').trim(); if (!q) return;
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`);
      const j = await res.json(); const r = j.results && j.results[0];
      if (!r) return toast('Place not found');
      saveSettings({ location: { name: `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}`, lat: r.latitude, lon: r.longitude } });
      toast('Weather location: ' + r.name); loadWeather(true); renderPage();
    } catch { toast("Couldn't look that up"); }
  },
  'set-api': (f) => { const url = String(new FormData(f).get('url') || '').trim(); if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return toast('That should be a script.google.com link'); store.apiUrl = url; store.since = 0; store.lock(); toast(url ? 'Saved — unlock with the family PIN' : 'Back to preview mode'); renderLock(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { if (el.tagName === 'A') e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && changes[el.dataset.change]) changes[el.dataset.change](el, e); });
document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el && inputs[el.dataset.input]) inputs[el.dataset.input](el, e); });
document.addEventListener('submit', e => { const f = e.target.closest('[data-submit]'); if (!f) return; e.preventDefault(); submits[f.dataset.submit]?.(f, e); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalRoot.innerHTML) { closeModal(); return; }
  if (document.body.classList.contains('locked') || modalRoot.innerHTML) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const r = route().page;
  if (e.key === 'n') { e.preventDefault(); newEvent(); }
  else if (e.key === 't') { prefs.cursor = L.today(); savePrefs(); r === 'calendar' ? renderPage(true) : go('calendar'); }
  else if (r === 'calendar' && e.key === 'ArrowLeft') calShift(-1);
  else if (r === 'calendar' && e.key === 'ArrowRight') calShift(1);
  else if ('mwdfl'.includes(e.key) && e.key.length === 1) { prefs.view = { m: 'month', w: 'week', d: 'day', f: 'family', l: 'list' }[e.key]; savePrefs(); r === 'calendar' ? renderPage(true) : go('calendar'); }
});

/* =====================================================================
   Boot
   ===================================================================== */
store.on(kind => {
  if (kind === 'status') { renderSync(); return; }
  if (kind === 'lock') { if (!document.body.classList.contains('locked')) { closeModal(true); renderLock(); } return; }
  if (kind === 'remote') { renderShellState(); softRender(); }
  if (kind === 'data') renderSync();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { store.sync(true); loadWeather(); } });
window.addEventListener('online', () => store.sync(true));
let resizeT; let lastWide = isWide();
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (isWide() !== lastWide) { lastWide = isWide(); if (route().page === 'calendar') renderPage(); } }, 200); });
setInterval(() => { renderSync(); if (route().page === 'home' && !modalRoot.innerHTML) softRender(); }, 60000);

function boot() {
  applyTheme();
  if (!store.isUnlocked) { renderLock(); return; }
  renderShell();
  renderPage(true);
  store.sync(true);
  loadWeather();
}
applyTheme();
boot();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
