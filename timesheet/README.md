# Calendar Timesheet

Reads your Google Calendar and produces a printable monthly timesheet laid out to match
the original template — Letter landscape, with the
`DATE | DAY | Timing | Hours | DESCRIPTION OF TASK | VERIFIED BY` grid and the
`TIME SHEET` / `NAME:` / `POSITION:` / `MONTH: … Year …` header block.

Live at <https://www.pallabshrestha.com.np/timesheet/>, linked from the
[Web apps](https://www.pallabshrestha.com.np/web-apps.html) page.

No build step, no dependencies, no backend. Everything runs in the browser; the app talks
to Google directly and nothing is sent anywhere else. Calendar access is **read-only**.

## Run it locally

From the repository root:

```bash
node timesheet/server.js
```

Then open <http://localhost:5173>.

A plain http origin is required — Google sign-in will not work if you open `index.html`
straight off the disk with `file://`.

## One-time Google setup

You need your own OAuth client ID (free). It takes about three minutes.

1. Create or pick a project in the [Google Cloud Console](https://console.cloud.google.com/projectcreate).
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** → *External* → fill in the app name and your
   email → under **Test users**, add your own Google address.
   (While the app is unpublished only test users can sign in — that is fine for personal use.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → application
   type **Web application**.
5. Under **Authorised JavaScript origins** add both of these, exactly:

   ```
   https://www.pallabshrestha.com.np
   http://localhost:5173
   ```

   The first is the live site, the second is for local development. Leave *Authorised
   redirect URIs* empty — this app uses the implicit token flow.
6. Copy the generated client ID into the app's **OAuth Client ID** box.

It is stored in your browser's localStorage, so you only paste it once, and separately per
origin — so the live site and localhost each want it entered once. A client ID is not a
secret; there is no client secret involved.

## Using it

1. **Connect Google Calendar**, then tick the calendars to draw from.
2. Enter **Name** and **Position**, pick the **Month** and **Year** (defaults to last month).
3. Adjust options, then **Generate timesheet**.
4. Click any cell in the preview to correct wording or sign off the **VERIFIED BY** column.
5. **Print / Save PDF** — in the print dialog choose *Save as PDF*, **Landscape**, paper
   **Letter**, and set margins to *Default*. Turn **off** "Headers and footers" so the
   browser does not stamp a URL onto the sheet.

`Export CSV` is also available, and it captures your manual edits.

## Options

| Option | What it does |
| --- | --- |
| One row per | `Event` gives a line per calendar entry; `Day` merges a day into one row, summing hours and joining titles with `;` |
| Date column format | `01/06/2026`, `1`, `1-Jun`, or `2026-06-01` |
| Time format | 24-hour or 12-hour in the *Timing* column |
| Round hours | Snap each row to the nearest 0.25 / 0.5 / 1 hour |
| Break deduction | Minutes subtracted from every row (per day in day-grouping mode) |
| All-day hours | Hours credited to an all-day event when those are included |
| Include all-day events | Off by default |
| Include events I declined | Off by default; cancelled events are always skipped |
| Include weekend events | On by default |
| Blank row for every empty day | Produces a full calendar-month sheet with gaps left to fill by hand |
| Append location / notes | Adds `— Location · Notes` after the event title |
| TOTAL row | Sums the Hours column at the end of the sheet |
| Exclude / Only if title contains | Comma-separated, case-insensitive substring filters |
| Rows per printed page | 21 matches the original template |

Timestamps are interpreted in your computer's local timezone. Recurring events are expanded
into individual occurrences, and only occurrences starting inside the selected month are used.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | UI shell |
| `app.js` | OAuth, Calendar API calls, row building, sheet rendering, CSV |
| `styles.css` | Screen UI plus the print block that reproduces the template geometry |
| `server.js` | Zero-dependency static file server, for local development only |

`server.js` is not used in production — GitHub Pages serves the folder directly.

## Troubleshooting

**"Sign-in was cancelled or blocked"** — the origin in Google Cloud must match the address
bar exactly, including the port and with no trailing slash. The app prints the origin it is
running on in the *Google setup* panel, so copy it from there. Also allow popups for the site.

**`access_denied` / "app is being tested"** — add your Google address under *Test users* on
the OAuth consent screen.

**"Your Google session expired"** — access tokens last about an hour. Click *Connect Google
Calendar* again; nothing is lost.

**Printed sheet spills onto a second page** — turn off "Headers and footers" in the print
dialog, set margins to *Default*, and check scale is 100%.
