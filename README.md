# 🏡 Family Hub

A shared family calendar and dashboard for **Kevin, Kate, Luke and Max** — hosted free on GitHub Pages, linked from Wix, and synced across every phone through a private Google Sheet protected by a family PIN.

**Live address (after setup):** `https://CHILLYCHILLY14.github.io/family-calendar/`
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

**Needs & Lists** — Groceries, Clothes, School, Sports Gear, Household, Other; for-whom, quantity, "needed soon", check off, undo; shared clothing-size cards

**Picky Eats** — 44 kid-friendly recipes across 🇨🇦 Canadian, 🇺🇸 American, 🇹🇭 Thai, 🇨🇳 Chinese, 🇯🇵 Japanese, 🇮🇹 Italian, 🇲🇽 Mexican, each with ingredients, steps, picky-eater tricks and a grown-up upgrade. Daily feed of new picks, weekly dinner planner, per-kid 👍 likes, one-tap "add ingredients to groceries", and your own family recipes.

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
