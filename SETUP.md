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
| **Daily checklist** (e.g. ☕ *Set coffee machine · 9pm*) | at its time, then every 15 min until someone taps ✓ Done | banner at the top of the app + phone push with a **✓ Done** button |
| **Event reminders** | 1 hour before games/appointments, 30 min for everything else (you choose per event) | phone push + pop-up while the app is open |
| **Morning summary** | 7am, if you turn it on | one message with the day's events, checklist, dinner and list counts |

### 1. Update the Google Apps Script (once)

1. Open your **Family Hub Data** sheet → **Extensions → Apps Script**.
2. Select all the old code and paste in the new `apps-script/Code.gs` from this repo.
3. Your PIN is unchanged — it stays in **Project Settings → Script properties** (`FAMILY_PIN`).
4. Click **💾 Save**, choose **setup** in the function list, press **▶ Run**, and allow the new permissions (it now sends notifications and runs a timer).
5. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** The web app URL stays the same, so nothing else needs changing.

The timer then checks every 5 minutes, whether or not anybody has the app open.

### 2. Get push notifications on each phone (free)

1. Install **ntfy** — [iPhone](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy).
2. In Family Hub: **Settings → 🔔 Reminders & notifications**, tap **🎲 Create** beside your name, then **📋 Copy**.
3. In the ntfy app tap **＋**, paste that topic name, **Subscribe**.
4. Back in Settings tap **🔔 Test** — the phone should buzz.
5. Use **Send … reminders for** to choose whose events you want (parents usually pick everyone; kids just themselves).

The topic name is the only secret, so keep it private — anyone who knows it can read those notifications. Prefer email? Put an address in the email box instead (or as well); Gmail allows about 100 reminder emails a day.

### 3. Pop-ups while the app is open

**Settings → Allow pop-ups** turns on browser notifications for that device. On iPhone this only works if you first add the app to the home screen (Share → Add to Home Screen). Phone push through ntfy works either way, which is why it's the recommended setup.

### Using the daily checklist

- It starts with **☕ Set coffee machine at 9pm** — open it from the dashboard to change the time, the days, or whose job it is.
- **＋ Add** has ready-made items: pack lunches, garbage night, sports bag, thaw meat, homework check, lock up, screen time off…
- Anyone can tap **✓ Done** — everyone else's phone sees it within seconds, and the reminders stop. Ticking items earns ⭐ stars on that person's page (kids like this more than you'd expect).
- On a phone notification, the **✓ Done** button ticks it off without opening anything.

---

## Meals: healthy, meal prep, and staying fresh

- **Do the recipes change?** Yes: the daily feed picks new ones every day, **🔄 New picks** reshuffles on demand, and **🌍 Discover new recipes** pulls fresh ideas from a free online library (TheMealDB) by cuisine — save any of them into *Our recipes* with one tap. You can also add your own.
- **🥗 Healthy** filters to the lighter, veggie- and protein-forward recipes.
- **📦 Meal prep** filters to batch recipes. Each shows how much it makes, how long it keeps, whether it freezes, and how to reheat.
- **Sunday meal prep**: open 2–4 prep recipes and tap **Add to prep plan**. Picky Eats then builds one combined shopping list (one tap to add it all to groceries), a cook-order game plan, and the storage notes for each dish.

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
