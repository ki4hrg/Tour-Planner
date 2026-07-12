---
name: verify
description: Build/launch/drive recipe for verifying Tour-Planner UI changes end-to-end in a real browser.
---

# Verifying Tour-Planner changes

## Launch

```bash
docker compose up -d postgres          # host port 5433
npm run dev &                          # http://localhost:3076 (ready in ~1s)
```

Login: `admin@example.com` / `changeme123` (seeded local admin).

## Drive with Playwright + installed Chrome

No Playwright in the repo and no downloaded browsers — install the library in the
scratchpad (`npm i playwright`, ~1s) and launch with `channel: "chrome"` (uses
/Applications/Google Chrome.app, no browser download):

```js
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
// login: fill input[type=email] / input[type=password] on /login, click button[type=submit],
// then waitForURL(u => !u.pathname.startsWith("/login"))
```

## Test data

Local DB has a small "Sample — Wesley Pilgrimage 2026" trip (2 days). For layout
cases, seed extra rows directly:

```bash
docker compose exec -T postgres psql -U tourplanner -d tourplanner
```

Gotchas: `ItineraryDay` has NO `order`/timestamps columns; `ScheduleItem` has no
timestamps; `ScheduleItemSite` links items→locations. Use recognizable ids
(`verify...`) and delete them after (ScheduleItem delete cascades to sites).

## Useful anchors

- Trip overview: `/trips/<id>` — itinerary panel day rows are
  `button:has-text("Day N")` collapsible triggers (`data-state` open/closed).
- Item rows have `id="item-<scheduleItemId>"` — good for `page.locator("#item-...")`.
