# 🏡 Family Hub

A shared family calendar and dashboard for **Kevin, Kate, Luke and Max** — hosted free on GitHub Pages, linked from Wix, and synced across every phone through a private Google Sheet protected by a family PIN.

**Website:** [Open Family Hub](https://chillychilly14.github.io/family-calendar/)

**Current configuration:** device-local preview (starter PIN `1234`). Cross-device sharing requires the one-time Google Sheets / Apps Script setup below.
**Setup guide:** [SETUP.md](SETUP.md)

## Features

**Calendar**
- Month, Week, Day, **Family** (person × day grid) and List views
- Filter by person (one, several, or everyone) and by activity
- Day view **split by person** into side-by-side columns
- Each person has their own colour (editable) on chips, bars, pages and events; shared events show every colour
- Activities: Volleyball 🏐, Soccer ⚽, Baseball ⚾, Ball Hockey 🏒, School 🏫, Work 💼, plus Family, Birthday, Appointment, Social, Chores, Other
- Repeating events (daily / weekly on chosen days / every N weeks / monthly / yearly, with an end date), edit or delete a single date
- Multi-day events (tournaments, trips), drop-off & pick-up drivers, "what to bring", notes, location
- Double-booking warnings, Ontario holidays & special days, weather + rain chance on outdoor games
- Share a day/week as text, print, add any event to a phone calendar (.ics)

**Dashboard**
- Greeting, weather, today's timeline, a card per person (next thing, busy count, needs)
- Next 7 days (routine work/school collapsed so games & appointments stand out)
- Tonight's dinner, needs summary, fridge notes, countdowns, this week's activity mix
- Personal page for each family member: schedule, needs, clothing sizes, foods they like

**Daily checklist & reminders**
- Repeating jobs with a big ✓ Done button — starts with ☕ *Set coffee machine · 9pm*; ready-made items for lunches, garbage night, sports bags, lock-up and more
- Due items show as a banner on every page until someone ticks them; ⭐ stars for whoever does them
- Reminders on phones even when the app is closed — emailed by Google from your own account, with a one-tap **✓ Mark it done** link — plus an optional 7am summary of the whole day
- Per-event reminders (1 hour before games by default), pop-ups while the app is open, and per-person control of whose reminders you receive

**Needs & Lists** — Groceries, Clothes, School, Sports Gear, Household, Other; for-whom, quantity, "needed soon", check off, undo; shared clothing-size cards

**Picky Eats** — 60 kid-friendly recipes across 🇨🇦 Canadian, 🇺🇸 American, 🇹🇭 Thai, 🇨🇳 Chinese, 🇯🇵 Japanese, 🇮🇹 Italian, 🇲🇽 Mexican, each with ingredients, steps, picky-eater tricks and a grown-up upgrade — including 🥗 healthy options and 📦 meal-prep batches. Every recipe carries storing & reheating notes: fridge life, freezer life, how to pack it, and how to reheat it properly. Daily feed that changes every day (🔄 for more), weekly dinner planner, Sunday prep-plan builder with one combined shopping list, per-kid 👍 likes, one-tap "add ingredients to groceries", your own recipes, and 🌍 Discover for endless fresh ideas from a free online library.

**Themes** — Light, Dark, Maple (warm), Aurora (northern lights), or Auto.

**Works everywhere** — phone-first, desktop sidebar, installable to the home screen, offline-friendly, Wix-embed friendly.

## How sharing works

```
Phones / computers ──(PIN → token)──► Google Apps Script web app ──► Google Sheet "Items" tab
        ▲                                                                   │
        └──────────── changes since last check (every ~25 s) ◄──────────────┘
```

Changes save instantly on the device, then sync in the background. If you're offline they wait and send when you're back.

## Files

```text
index.html            App page
app.js                Screens and interactions
store.js              Local cache + sync with Google
lib.js                Dates, repeats, holidays, people/activity defaults
meals.js              Recipe library + daily picks
config.js             ← paste your Apps Script URL here
styles.css            Layout + 4 themes
sw.js                 Offline support (network-first, so updates show right away)
apps-script/Code.gs   ← paste into Google Apps Script (holds the PIN)
tests.mjs             npm test — repeats, holidays, recipes, and the real backend code
test/                 Local stand-in for Google, for testing sync
```

Run locally: `npm test` then `npm run serve` → http://localhost:4173 (preview PIN 1234).

## Deployment and checks

Every push to `main` runs `npm test`, builds the public app with `npm run build`, and deploys through GitHub Actions. The workflow verifies the published commit and essential assets. Select **GitHub Actions** as the Pages source. No npm dependencies or paid hosting are needed.

The app keeps offline caches limited to this project, saves its local state atomically, retains server-rejected changes, and warns when browser storage is unavailable. Calendar exports include skipped dates and compatible recurrence rules. Recurrence and sync regression tests run locally without contacting Google.

The family server PIN belongs in the private Apps Script `FAMILY_PIN` property. The preview PIN is only a device convenience lock; it does not encrypt browser data. Changing a custom preview PIN no longer displays it on the lock screen.
