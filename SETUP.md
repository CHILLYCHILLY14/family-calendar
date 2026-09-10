# Family Hub — setup (about 15 minutes, all free)

There are three parts:

1. **GitHub** hosts the website (the app itself).
2. **A Google Sheet** stores the family's events, lists and notes so every phone sees the same thing. The PIN is checked here.
3. **Wix** shows a button or embedded page that opens it.

You can do part 1 first and play with the app right away — until part 2 is done it runs in **preview mode** (saves on one device only, preview PIN `1234`).

---

## Part 1 — Put the app on GitHub Pages

1. Sign in at github.com → **＋** (top right) → **New repository**.
2. Name it `family-calendar`. Choose **Public** (free GitHub Pages needs public; the family's data is *not* in the repo — it lives in your private Google Sheet behind the PIN).
3. Click **Create repository**, then **uploading an existing file**.
4. Unzip `family-calendar.zip` on your Mac, open the folder, select **everything inside it** and drag it into the GitHub page. Click **Commit changes**.
5. Go to **Settings → Pages**. Under *Build and deployment* choose **Source: Deploy from a branch**, **Branch: main**, folder **/(root)** → **Save**.
6. After a minute or two your app is live at:
   **`https://CHILLYCHILLY14.github.io/family-calendar/`**

Open it, enter `1234`, and try **Settings → Add sample events** to see everything filled in.

---

## Part 2 — Turn on sharing between phones (Google Sheet)

1. Go to **sheets.google.com** → create a **Blank spreadsheet**. Name it `Family Hub Data`.
2. In the sheet: **Extensions → Apps Script**.
3. Delete the sample code, then paste in everything from `apps-script/Code.gs` (from the zip).
4. **Change the PIN** on this line near the top — use 6 or more digits:
   ```js
   const FAMILY_PIN = '2468';
   ```
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
Edit `FAMILY_PIN` in Apps Script → **Save** → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. The URL stays the same. Every device will be asked for the new PIN.

### How safe is it?
- The PIN is checked by Google on the server, not in the website code, so reading the public GitHub code doesn't reveal it.
- After 8 wrong PINs, PIN entry pauses for 15 minutes.
- Your data is only in your Google Sheet (tab **Items**). You can look at it, and it's automatically backed up by Google. The app also has **Settings → Export backup**.
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

Tip: you can also password-protect that Wix page (Page settings → Permissions) for an extra lock, but the app's own PIN already protects the data.

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
| Want to start over | Delete the rows in the **Items** tab of the sheet (keep row 1). |
