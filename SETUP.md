# Family Hub — setup (about 15 minutes, all free)

There are three parts:

1. **GitHub** hosts the website (the app itself).
2. **A Google Sheet** stores the family's events, lists and notes so every phone sees the same thing. The PIN is checked here.
3. **Wix** shows a button or embedded page that opens it.

You can do part 1 first and play with the app right away — until part 2 is done it runs in **preview mode** (saves on one device only, preview PIN `1234`).

---

## Part 1 — Put the app on GitHub Pages

The repository is **CHILLYCHILLY14/family-calendar** and includes automatic checks and deployment.

1. Open **Settings → Pages** and choose **Source: GitHub Actions**.
2. Commit changes to `main`. The **Check and deploy Family Hub** workflow tests the app, packages its public files, deploys them, and checks the live version.
3. Open [Family Hub](https://chillychilly14.github.io/family-calendar/).

If a check fails, the workflow stops before deployment. Backend source and tests stay in the repository; they are excluded from the deployed website.

Open it, enter `1234`, and try **Settings → Add sample events** to see everything filled in.

---

## Part 2 — Turn on sharing between phones (Google Sheet)

1. Go to **sheets.google.com** → create a **Blank spreadsheet**. Name it `Family Hub Data`.
2. In the sheet: **Extensions → Apps Script**.
3. Delete the sample code, then paste in everything from `apps-script/Code.gs` (from the zip).
4. Open **Project Settings** (gear on the left) → **Script properties → Add script property**. Set **Property** to `FAMILY_PIN` and **Value** to your own 4–12 digit PIN, then **Save script properties**. The backend will not accept a PIN until this is configured. Do not put your real PIN in any GitHub file.
5. Click **💾 Save**. In the function dropdown pick **setup** and press **▶ Run**.
   Google asks for permission: **Review permissions → your account → Advanced → Go to Family Hub (unsafe) → Allow**. (It says "unsafe" only because it's your own private script, not a published app.)
6. Click **Deploy → New deployment** → gear ⚙️ → **Web app**:
   - Description: `Family Hub`
   - **Execute as: Me**
   - **Who has access: Anyone**
   → **Deploy**. Copy the **Web app URL** (it ends in `/exec`).
7. Back on GitHub, open `config.js` → ✏️ (edit) → paste the URL between the quotes:
   ```js
   API_URL: 'https://script.google.com/macros/s/AKfy..../exec',
   ```
   → **Commit changes**.
8. Wait a minute, refresh the app. It now asks for **your** PIN. Share the link + PIN with Kate, Luke and Max — everyone sees the same calendar. 🎉

> Want to test before committing? In the app: **Settings → Sharing & sync → Advanced** lets you paste the URL for just that one device.

### Changing the PIN later
Change the `FAMILY_PIN` value in **Apps Script → Project Settings → Script properties** and save it. No code change or new deployment is required for a PIN change. The URL stays the same, and devices must unlock with the new PIN at their next sync. Deploy a new version when you change the script code itself.

### How safe is it?
- The PIN is checked by Google on the server, not in the website code, so reading the public GitHub code doesn't reveal it.
- After 8 wrong PINs, PIN entry pauses for 15 minutes.
- Shared data is saved in your private Google Sheet (tab **Items**) and cached locally on each device for offline use. **Lock** clears the access token but does not erase or encrypt the local cache. Use your phone/computer passcode on shared devices. Use **Settings → Export backup** regularly; Google Sheets version history is not a separate backup.
- Anyone who has the PIN can see and edit — same as a paper calendar on the fridge. Use a PIN the kids can remember but a stranger can't guess.

---

## Part 3 — Link it from your free Wix site

**Option A — a big button (best on phones)**
1. In the Wix editor: **Add Elements (＋) → Button**. Text: `Open Family Calendar`.
2. Click the button → **Link** → **Web address** → paste `https://CHILLYCHILLY14.github.io/family-calendar/` → **Open in a new tab** → Done.

**Option B — show it inside a Wix page**
1. **Add Elements → Embed Code → Embed a Site** → paste the same URL.
2. Stretch it to full width. Set a fixed height (desktop about **850 px**; mobile about **700–800 px**). Turn **off** any "auto height" / "fit to content".
3. Keep a button (Option A) above it too — when embedded, the app also shows a **↗** button to pop out full screen.
4. **Publish**.

Tip: Wix page protection only protects that Wix page; the GitHub Pages link remains publicly reachable. In shared mode, the Google backend checks the family PIN before sending calendar data. Preview mode is device-local and its PIN is a convenience lock, not encryption.

---

## Reminders & notifications

Three kinds of alerts:

| What | When | Where it shows |
|---|---|---|
| **Daily checklist** (e.g. ☕ *Set coffee machine · 9pm*) | at its time, then every 15 min until someone taps ✓ Done | banner at the top of the app + an email with a **✓ Mark it done** link |
| **Event reminders** | 1 hour before games/appointments, 30 min for everything else (you choose per event) | email + pop-up while the app is open |
| **Morning summary** | 7am, if you turn it on | one message with the day's events, checklist, dinner and list counts |

### 1. Update the Google Apps Script (once)

1. Open your **Family Hub Data** sheet → **Extensions → Apps Script**.
2. Select all the old code and paste in the new `apps-script/Code.gs` from this repo.
3. Your PIN is unchanged — it stays in **Project Settings → Script properties** (`FAMILY_PIN`).
4. Click **💾 Save**, choose **setup** in the function list, press **▶ Run**, and allow the new permissions (it now sends notifications and runs a timer).
5. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The web app URL stays the same, so nothing else needs changing.

The timer then checks every 5 minutes, whether or not anybody has the app open.

### 2. Add each person's email (that's the whole setup)

In Family Hub: **Settings → 🔔 Reminders & notifications** → put an email address beside each name → **🔔 Test**.

Reminders are sent by Google from your own Gmail, so nothing can block them. On a phone they arrive like any other mail notification — make sure the mail app is allowed to show notifications (iPhone: Settings → Notifications → Mail). Checklist emails include a one-tap **✓ Mark it done** link that ticks the item off for the whole family without opening anything. Gmail allows about 100 of these a day, far more than a family needs.

Use **Send … reminders for** to choose whose events each person hears about — parents usually pick everyone, kids just themselves.

> **Why not phone-push apps?** The app can also publish to [ntfy](https://ntfy.sh), but Google's servers cannot reach ntfy.sh ("Address unavailable"), so scheduled reminders can't go out that way. The field is still there under *Advanced* if you ever self-host ntfy on your own domain.

### Using the daily checklist

- It starts with **☕ Set coffee machine at 9pm** — open it from the dashboard to change the time, the days, or whose job it is.
- **＋ Add** has ready-made items: pack lunches, garbage night, sports bag, thaw meat, homework check, lock up, screen time off…
- Anyone can tap **✓ Done** — everyone else's phone sees it within seconds, and the reminders stop. Ticking items earns ⭐ stars on that person's page (kids like this more than you'd expect).
- On a phone notification, the **✓ Done** button ticks it off without opening anything.

---

## Meals: healthy, meal prep, and staying fresh

- **Do the recipes change?** Yes: the daily feed picks new ones every day, **🔄 New picks** reshuffles on demand, and **🌍 Discover new recipes** pulls fresh ideas from a free online library (TheMealDB) by cuisine — save any of them into *Our recipes* with one tap. You can also add your own.
- **🥗 Healthy** filters to the lighter, veggie- and protein-forward recipes.
- **📦 Meal prep** filters to batch recipes, and **❄️ Freezes well** to the ones worth doubling.
- **Every** recipe — not just the prep ones — shows *Storing & reheating*: how long it keeps in the fridge, whether (and how long) it freezes, how to pack it so it survives, and exactly how to reheat it.
- **Sunday meal prep**: open 2–4 prep recipes and tap **Add to prep plan**. Picky Eats then builds one combined shopping list (one tap to add it all to groceries), a cook-order game plan, and the storage notes for each dish.

---

## Put the calendar on everyone's phone (subscription link)

**Settings → 📅 Show it in your phone's calendar → Get the calendar link.** You get one link for the whole family and one per person.

- **iPhone:** Settings → Apps → Calendar → Calendar Accounts → Add Account → Other → **Add Subscribed Calendar** → paste the link. Then in Calendar, tap the new calendar and turn its alerts on. iPhone re-checks it often (you can set the interval).
- **Google Calendar:** calendar.google.com → *Other calendars* **+** → **From URL** → paste. Google only refreshes subscribed links every few hours, sometimes a day, so treat it as a view, not a reminder.
- **Outlook:** Add calendar → Subscribe from web → paste.

**Is it safe?** The link carries a long random key that has nothing to do with your PIN, it is read-only, and it contains events only — no lists, notes, meal plans, checklist or settings. Anyone who has the link can read the family schedule, so share it inside the family only. **↻ Make a new link** kills the old one instantly if it ever leaks.

---

## Import a whole season at once

On the **Calendar** page, **📥 Import schedule**:

- **Paste** a schedule from an email or a league site — one game per line. It understands the usual shapes: `Sat Sep 20 10:00 AM vs Ajax @ Kinsmen Field 3`, `2026-09-28, 13:30, Practice`, `10/4 9am vs Oshawa`. A line with no time becomes an all-day entry; a line with no date is listed as skipped so you can see what it missed.
- **Or pick a `.ics` file** exported from TeamSnap, SportsEngine, a school board or another calendar — repeats, skipped dates and all-day trips come across intact.
- Set the activity, who it's for and a reminder once, and it applies to everything you're importing.
- You see every event with a checkbox **before** anything is added, and if a line says "Sat" but the date is a Sunday it tells you — usually a wrong year in the paste.
- Added the wrong batch? The **Undo** button on the toast removes the whole import.

---

## Backups and tidying (automatic)

Once the script is set up it also:

- saves a full JSON backup to **Google Drive → Family Hub Backups** every Sunday night, keeping the last 8;
- tidies up on the 1st of each month — checklist ticks older than 120 days and deleted rows older than 60 days — after taking a fresh backup first, so syncing stays quick as the years add up.

**Settings → Backup → ☁️ Back up to Drive now** does it on demand. Your own **⬇️ Export backup** still works too.

---

## Add it to everyone's home screen

- **iPhone/iPad:** open the GitHub link in **Safari** → **Share** → **Add to Home Screen**.
- **Android:** open in **Chrome** → **⋮** → **Add to Home screen / Install app**.

It then opens like a normal app, full screen, with its own icon.

---

## Everyday tips

- **Tap a person's chip** to filter; tap several to see just the kids, etc. **Everyone** shows all.
- **Family** view = one row per person for the week. **Day → Split by person** = side-by-side columns.
- Events can repeat (e.g. Tue & Thu until end of season), and you can change or delete **just one date** of a repeating event.
- Set **Drop-off / Pick-up** on practices — it shows on the dashboard.
- Outdoor activities (soccer, baseball, ball hockey) show the rain chance when the forecast is available.
- In **Picky Eats**, tap 👍 for each kid who likes a recipe — it builds their "safe foods" list on their page. **Add checked to groceries** puts ingredients on the shopping list.
- On a computer: **N** = new event, **T** = today, **← →** = move, **M / W / D / F / L** = views.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Can't reach the family server" | Check the `/exec` URL in `config.js`. In Apps Script, the deployment must be **Anyone**. |
| Changed Code.gs but nothing changed | Deploy → Manage deployments → Edit → **New version**. |
| A phone shows old content | Pull down/refresh. The app always checks for the newest version when online. |
| Wrong PIN lockout | Wait 15 minutes. |
| Want to remove events | Delete them in the app so the deletion syncs to every device. Export a backup first if removing many items. |
| Storage unavailable | Keep the tab open and export a backup. Free browser storage or open Family Hub directly rather than inside Wix. |
| A saved server link is wrong | Use **Connection help** on the PIN screen to correct the `/exec` link. |

## Updating an older backend

Paste the updated `apps-script/Code.gs` into the existing Apps Script project, add your `FAMILY_PIN` Script property, and deploy a new version under the existing deployment. Keep the same Sheet and `/exec` URL. The updated app preserves existing device data and works with the original sync response format.

## Sports Budget (Season Ledger)

Open **Home → Sports Budget**, or **Sports Budget** in the desktop sidebar. The ledger uses the existing Family Hub connection and family PIN. No additional Google Sheet, Apps Script deployment or token is required. The original standalone ledger backend is not used.

- **Teams:** edit the starter kids and teams, add payers, and set optional team budgets.
- **Expenses:** enter dates, amounts in CAD, category, details, notes and who paid. Paid and Due count toward the season total; Reimbursed is shown separately.
- **Travel:** enter your own fuel, hotel and food estimates. The calculator includes return driving. Adding a trip creates separate Due entries; change them to Paid after payment.
- **CSV:** exports respect the current expense filters. Import adds rows after confirmation and does not replace your books. Importing the same file twice creates duplicates. Clear filters before exporting the full expense list.
- **Sharing:** each row uses Family Hub's normal sync queue. Existing full JSON backups include all ledger records and team settings.

The season label renames the current books; it does not create a separate historical season.
