@AGENTS.md

## MCP Server

Remote MCP endpoint at `/mcp` (Streamable HTTP; `src/app/mcp/route.ts`). OAuth 2.1 at `/api/oauth/*`.
Discovery at `/.well-known/oauth-protected-resource` (also `/.well-known/oauth-protected-resource/mcp`,
the RFC 9728 path-suffixed form; same document) and `/.well-known/oauth-authorization-server`
(served via rewrites in `next.config.ts` to `/api/well-known/*`). The `/mcp` 401 sends
`WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"`.
`src/proxy.ts` excludes `.well-known` from its auth matcher, so discovery is never redirected to login.

The `/mcp` route creates a fresh `WebStandardStreamableHTTPServerTransport` per request
with `enableJsonResponse: true`. This is required: the handler closes the transport in a
`finally` right after `handleRequest()` returns, so the default SSE-streaming mode (which writes
the reply asynchronously) would tear the stream down before the response is sent. JSON mode makes
`handleRequest()` resolve only once the full response is built.

### Adding a new MCP tool

1. Create or extend a file in `src/lib/mcp/tools/`.
2. Export a `register*Tools(server: McpServer, user: SessionUser)` function.
3. Register tools with `server.registerTool(name, config, handler)`, where `config` is
   `{ title, description, inputSchema, annotations }`:
   - `inputSchema` is a plain object of Zod shapes (e.g. `{ tripId: z.string() }`), NOT wrapped in `z.object()`.
   - `title` is a short human-readable label (e.g. `"Get Trip Details"`).
   - `annotations` are behavior hints. Read tools: `{ readOnlyHint: true, openWorldHint: false }`.
     Writes: `{ readOnlyHint: false, destructiveHint: <deletes?>, idempotentHint: <update=true/add=false>, openWorldHint: false }`.
     `openWorldHint` is always `false` — these tools operate on our own database, a closed world.
4. Gate mutations with `hasRole(user.role, "PLANNER")` — read tools require VIEWER, writes PLANNER, admin ops ADMIN.
   Return `{ content: [{ type: "text", text: "Error: ..." }], isError: true }` on auth failure.
5. Reuse Zod validators from `src/lib/validators/` and Prisma query patterns from `src/app/(app)/*/actions.ts`.
6. Tool descriptions must state what the tool does, what IDs it needs (and which other tool provides them), and what it returns.
7. Register the tool module in `src/lib/mcp/server.ts` by calling your register function.
8. Do NOT call `revalidatePath` from MCP tools — that is a Next.js RSC concern.
   MCP mutations write to the DB directly; the web UI revalidates on its own page loads.

### Tool inventory

55 tools, one `register*Tools` function per file in `src/lib/mcp/tools/`. Role is the
minimum required (VIEWER = read, PLANNER = write). All `openWorldHint: false`.

**trips.ts** — `list-trips` (V), `get-trip` (V, incl. booking-status counts),
`create-trip` (P), `update-trip` (P, a `startDate` change redates days + shifts dated stays in a txn).

**itinerary.ts** — `list-schedule-categories` (V, resolves `categoryId`),
`get-itinerary` (V, the full day→item→site/booking tree, incl. each day's rough-plan
`plannedLocations` + `cityRegion`), `add-day` (P),
`update-day` (P, title + logistical/participant notes + primary location/city), `delete-day` (P, renumbers +
recomputes dates + shifts stays in a txn; reports `collapsedStays`), `add-schedule-item` (P, `fixedTime` pins times reorders/shifts never move), `update-schedule-item` (P),
`delete-schedule-item` (P, renumbers `order` in a txn), `add-planned-location`
(P, rough day→location assignment with no times — GH #9; idempotent per
`(day, location)`), `remove-planned-location` (P, by `(dayId, locationId)`),
`promote-planned-location` (P, converts a rough assignment into a time-less
schedule item, then drops it), `reorder-days` (P, full day-id order; `dryRun`
previews, `moveStays` shifts lodging whose nights moved together),
`move-schedule-item` (P, within a day = re-sequence with time cascade; across
days the item keeps its times and lands by them), `move-planned-location` (P).
Shared logic: `src/lib/itinerary-mutations.ts`.

**bookings.ts** — `list-bookings` (V, venue-engagement + site-less item bookings,
incl. agreed price + `agreedTotal` (per-person rate × headcount) + paid total + workflow progress), `add-booking` (P, upserts the `(trip, location)`
engagement — refuses not-bookable venues, seeds standing terms + default workflow on create; item target
only for site-less items; idempotent; takes `bookedOn` + `agreedAmount`/`agreedCurrency`/`agreedUnit`),
`update-booking` (P, incl. `bookedOn`; status goes through the workflow rules),
`list-booking-workflows` (V, resolves `workflowId`/`stepId`), `set-booking-step` (P, tick/untick
one step, back-datable), `set-booking-workflow` (P, switch workflow; clears ticked steps),
`list-payments` (V, the payment log +
outstanding balance), `add-payment` (P, logs a payment against the booking's agreed price).

**locations.ts** — `search-locations` (V), `get-location` (V, incl. costs, standing
payment terms, host site + Google place link), `list-regions` (V, resolves `regionId`), `list-trip-types`
(V, resolves `tripTypeId`), `create-location` (P), `update-location` (P; both take
`googlePlaceId` + `lat`/`lng`, the coords both-or-neither),
`set-host-site` (P, upserts capability flags or `remove`s host-site status),
`set-primary-contact` (P, links the contact + marks it primary, or clears the
designation), `add-location-cost` (P), `update-location-cost` (P),
`set-location-payment-schedule` (P, REPLACE the venue's standing terms that seed new
engagements — GH #86), `merge-locations` (P, destructive: folds a duplicate into the
kept location + deletes it; `dryRun` previews — see Location merge below).

**contacts.ts** — `search-contacts` (V), `create-contact` (P), `update-contact` (P).
Passing `locationIds` on a write REPLACES the linked-location set.

**presentations.ts** — `list-presentations` (V), `get-presentation` (V, incl. the
occurrences that deliver it), `create-presentation` (P), `update-presentation` (P).
Passing `defaultPresenterIds` on a write REPLACES the default-presenter set.

**stays.ts** — `list-stays` (V), `add-stay` (P), `update-stay` (P). Lodging booking
state lives on the venue-engagement Booking, NOT the Stay — see `list-bookings`. A
stay anchors EITHER to calendar dates (dated trip) OR to 1-based day numbers
(date-less template): `add`/`update` pick the mode from the trip and pass the
matching pair (`checkIn`/`checkOut` vs `checkInDayIndex`/`checkOutDayIndex`).

**documents.ts** — `list-documents` (V, metadata + a `downloadUrl` that still needs
an authenticated session; never the bytes), `add-document` (P, bytes as base64 —
this is how an agent files a generated participant itinerary), `update-document`
(P, metadata only; `shareAudiences` REPLACES the released-to set),
`delete-document` (P, hard delete — no archive, blob cascades).

**notes.ts** — `list-notes` (V), `add-note` (P). Polymorphic `target` ∈
`location | booking | trip | stay`; `add-note` defaults `contactedOn` to today via
`todayUtc()` and best-effort pushes a flagged follow-up to the caller's Todoist
(see Todoist section; failures come back as `todoistWarning`, never an error).

### Deliberately NOT exposed over MCP (revisit if needed)

- **Deletes for trip / location / presentation / contact.** Destructive, and the web
  actions carry archive-vs-hard-delete logic (e.g. `deleteLocation`/`deletePresentation`
  archive when referenced by a schedule item, hard-delete only when unreferenced;
  `deleteContact` relies on `SetNull` FKs). Item/day/stay/booking deletes ARE exposed
  because they're scoped and low-blast-radius. Add the entity-level deletes only with
  the same archive-fallback behavior, not a bare `prisma.*.delete`.
- **Booking workflow DEFINITIONS** (create/edit/delete a workflow or its steps) — ADMIN
  config, web-only at `/admin/workflows`. Only the read side + moving a booking through
  a workflow is exposed.
- **Region / trip-type / schedule-category / user CREATION + admin ops.** These are
  ADMIN-managed catalog/config. Only the read side is exposed (`list-regions`,
  `list-trip-types`, `list-schedule-categories`) so write tools can resolve their IDs.
  If exposed later, gate with `hasRole(user.role, "ADMIN")`.
- **ShareLink tools (mint / enable / disable / delete).** Share tokens are unguessable
  capabilities that expose trip data to outside audiences (PARTICIPANT / HOST_SITE);
  minting them over MCP widens the blast radius of a leaked token. Revisit only with a
  clear use case, and mirror the server-side redaction (`redactDaysForShare`).
- **Document bytes over MCP reads.** `list-documents` returns metadata and a URL,
  never the file. Streaming a 25MB base64 blob into a tool result would blow the
  context for no gain; the URL works in any authenticated browser session.
- **`update-note` / `delete-note`.** Only create + list are exposed; editing/removing
  log entries is rare and currently a UI-only concern.
- Access tokens: stateless JWTs signed with `AUTH_SECRET` (HS256), audience `tour-planner-mcp`, **15-minute** TTL.
  They embed a `sid` claim = the issuing refresh token's id (the session). The MCP hot path verifies the
  signature only — it never reads the DB.
- Refresh tokens: opaque (32 random bytes, base64url), stored **hashed** (SHA-256) in `OAuthRefreshToken`, 30-day TTL.
  Rotated on every use: each `refresh_token` grant mints a new pair and revokes the presented token. A `familyId`
  groups all tokens descended from one authorization grant; presenting an already-rotated (revoked) token is treated
  as theft and revokes the whole family.
- Token revocation at `/api/oauth/revoke` (RFC 7009). Accepts a refresh token or an access token (revokes the
  session via its `sid`). Always returns 200. Because access tokens are self-contained, a revoked one keeps working
  until it expires (≤15 min); revocation immediately stops the session from minting new access tokens.
- Auth codes: single-use, 10-minute TTL, stored in `OAuthAuthorizationCode` table.
- Dynamic client registration at `/api/oauth/register` (RFC 7591). Default `grantTypes` = `authorization_code`, `refresh_token`.
- PKCE S256 is mandatory (OAuth 2.1).
- Scope-to-role mapping: VIEWER → `mcp:read`, PLANNER → `mcp:read mcp:write`, ADMIN → `mcp:read mcp:write mcp:admin`.
- The authorize endpoint (`/api/oauth/authorize`) renders a minimal HTML login form — not the React app login page.
- OAuth/MCP routes are excluded from the auth middleware in `src/proxy.ts`.

## Todoist follow-ups

Per-user, personal-token integration (`/settings`); the model (`TodoistConnection`
`authType`/`refreshToken`/`expiresAt`) is pre-shaped for OAuth. Flagging a note as
follow-up pushes a Todoist task (label `tour-planner`, due = `dueDate`, description
= `AUTH_URL` deep link); unchecking/deleting closes it. Completions flow back via
`reconcileTodoistFollowUps` (lazy, ~60s-throttled via `lastReconciledAt`), called
from the dashboard render. Routing: trip-context note → `TripTodoistLink` →
`TripTypeTodoistLink` → connection default → Inbox; location-only note → the note
form's destination select (pre-picked by `resolveLocationProject`). Layers:
`src/lib/todoist.ts` (pure API v1 client), `src/lib/todoist-sync.ts` (Prisma-aware
push/reconcile; NO revalidatePath — MCP-safe), `src/lib/crypto.ts` (AES-256-GCM
token encryption keyed off `AUTH_SECRET`; tokens never reach the client — the UI
shows last-4 only). Everything Todoist is best-effort: an outage downgrades the
toast message but never fails the note save.

## Google places (location place IDs + coordinates)

`Location.googlePlaceId` / `lat` / `lng` (coords both-or-neither, DB CHECK
`location_coordinates`) + `placeIdCheckedAt` / `placeIdNeedsReview`. All Google
calls are **server-side** with `GOOGLE_MAPS_API_KEY` (Places API (New); unset ⇒
search hidden, coords still hand-editable) — the key never reaches the browser.
`src/lib/google-places.ts` is the pure HTTP client; field masks are deliberately
minimal (Details for a pick: `id,location,formattedAddress` — no `displayName`,
it's a Pro field; refresh: `id` only). Surfaces:
- **Location form** `GooglePlaceField` → `locations/place-actions.ts` (autocomplete
  session token + details). Picking offers to fill an empty address; never overwrites.
- **Backfill** `/admin/places` (ADMIN): Text Search candidates per unlinked location;
  a human must **Accept** — never auto-link (a wrong place is worse than none).
- **Refresh**: `src/lib/place-refresh.ts` re-resolves IDs older than 12 months;
  a changed ID is stored, NOT_FOUND clears the ID (keeps coords) and sets
  `placeIdNeedsReview` (listed first on `/admin/places`). Runs daily from an
  in-process timer started in `src/instrumentation.ts` (single container — no
  external cron), plus a "Refresh now" button.
- **`mapHref`** (`src/lib/maps.ts`) order: curated `mapUrl` → place ID
  (`…search/?api=1&query=<name>&query_place_id=<id>`) → `lat,lng` → name+address.
  Derived links must keep the `https://www.google.com/maps/search/?api=1&query=`
  prefix — the WordPress plugin treats that prefix as "derived" and ignores it.

## Stack

Next.js 16 (App Router, `src/`), React 19, TypeScript, Tailwind 4, shadcn/ui (Radix
base; primitives in `src/components/ui`). Prisma **6** (deliberately pinned — NOT 7)
on Postgres **18**. Auth.js v5 (next-auth beta) credentials + JWT; roles
ADMIN / PLANNER / VIEWER. PWA via Serwist. Package manager: npm. App runs on **port 3076**.

## Local development

```
docker compose up -d postgres     # host port 5433 → container 5432
npx prisma migrate dev            # apply migrations
npm run db:seed                   # admin (if SEED_ADMIN_*) + Wesley trip type + categories + starter locations
npm run dev                       # http://localhost:3076 (Turbopack; Serwist disabled in dev)
npx tsc --noEmit && npm run lint  # both MUST be clean before commit
npm run build                     # prod build (uses --webpack for Serwist)
npm test                          # vitest
```

- Local admin: `admin@example.com` / `changeme123` (from `.env` `SEED_ADMIN_*`).
- Auth over curl: GET `/api/auth/csrf` → POST `/api/auth/callback/credentials`
  (`csrfToken`+`email`+`password`+`callbackUrl`), reusing a cookie jar.

## Architecture & conventions

- **Reads** = Server Components; **mutations** = Server Actions (`"use server"`).
- **Action result**: `FormState { ok?, error?, message? }` from `src/lib/forms.ts`.
  Two patterns coexist: form-driven actions use `useActionState` + a `sonner` toast
  (see `trip-form.tsx`); the itinerary/lodging/share editors use **direct-call**
  actions (typed args, return `FormState`) driven by a small local `useAction()`
  (`useTransition` + toast) helper.
- **UI copy**: no narration. No page/card subtitles or taglines, no helper
  paragraphs explaining how a feature works or why it was designed that way, no
  chatty empty states ("No stays." + the action button is enough). Buttons are
  short verbs, headings are nouns, toasts are short facts ("Saved."). Convey state
  with design cues (icons, badges, color, disabled states, `aria-label`) instead of
  prose. Destructive confirmations may keep one line stating the consequence.
  Design rationale belongs in code comments, never in the rendered UI. Never
  instruct ("— set a primary contact", "add one in Admin"): if the page can take
  the user straight there, render that as a verb-labelled link/button; otherwise
  state the fact only. Terse must not mean ambiguous: avoid clipped passive
  fragments ("Shown once — copy it now", "Unticked = staff only") that blur fact
  and instruction. Write a plain sentence for the fact and make the action the
  control ("This key will only be shown once. Click to copy." on a clickable key).
- **Authz** (`src/lib/authz.ts`): `requireUser()` / `requireRole(min)` in pages,
  `assertRole(min)` at the top of every mutation, `hasRole(role, min)` for checks.
  VIEWER is read-only.
- **Validators**: zod in `src/lib/validators/*.ts`; empty string → undefined via
  `z.preprocess` for optional numbers/dates.
- **Decimal / Date boundary**: never pass a Prisma `Decimal` or `Date` to a Client
  Component. Serialize first — `serialize*` helpers in `src/lib/trips.ts`,
  `serializeCost` in `src/lib/money.ts`. Calendar dates are `@db.Date` (date-only,
  UTC helpers in `src/lib/dates.ts`); times are `"HH:MM"` strings.
- **Public/shared pages**: strip data the audience can't see **server-side** before
  it reaches a Client Component — anything passed as props rides along in the RSC
  payload (view-source visible) even if not rendered. See `redactDaysForShare`
  (`src/lib/share.ts`).
- **Routing**: authenticated pages live under `src/app/(app)/` (shell = `AppNav` +
  `requireUser` layout). Public routes: `/login`, `/setup`, `/share/[token]`,
  `/api/{auth,oauth,well-known}`, `/mcp`, `/api/feed/[token].ics`,
  `/api/share/[token].ics`, `/api/share/[token]/documents/[id]`. The `src/proxy.ts` matcher excludes those + assets
  (add the route's path segment to the negative lookahead when introducing a new
  public endpoint).
- **Calendar feeds (`CalendarFeed`)**: subscribable iCalendar (.ics) feeds served at
  `/api/feed/<token>.ics` (`webcal://` for one-tap subscribe). Token is an unguessable
  cuid capability like a `ShareLink`; `scope` ∈ `TRIP | TRIP_TYPE | ALL` (DB CHECK
  `calendar_feed_scope` ties scope to exactly one of `tripId`/`tripTypeId`/neither).
  These are **STAFF-detail** feeds (full itinerary incl. logistical notes); template
  trips are excluded (no dates to anchor). Times are emitted as **floating** local
  (no `Z`/`TZID`) since the app stores tz-free `"HH:MM"` — see `src/lib/ics.ts` (pure
  RFC 5545 generator) + `src/lib/calendar-feed.ts` (day/item/stay → events), both
  unit-tested. Mint/copy UI: `CalendarFeedManager`, mounted on the trip page,
  trip-type page, and `/settings` (the ALL feed).
- **Participant-safe calendar feeds (`ShareLink` .ics, GH #81)**: the redacted,
  audience-scoped counterpart to `CalendarFeed`, served at `/api/share/<token>.ics`
  off the same `ShareLink` token the `/share/<token>` HTML page uses. Reuses the
  `src/lib/ics.ts` + `src/lib/calendar-feed.ts` generators; `src/lib/share-feed.ts`
  (`buildShareFeedEvents`, unit-tested) applies the audience redaction **before**
  events are built — `scopeDaysToLocation` + `redactDaysForShare` for HOST_SITE
  scope + booking strip, and for any non-STAFF audience also strips day logistical
  notes, trip-level notes, and stay notes — so a PARTICIPANT/HOST_SITE feed can
  never leak bookings, contacts, or internal notes even in the raw payload (mirrors
  the HTML share redaction; never rely on omitting at render). Honours
  `isShareLinkActive` (404 on unknown/disabled/expired). Copy/subscribe affordance
  lives in `ShareManager` next to each link (webcal:// + https:// ics URLs).
- **Data model**: `prisma/schema.prisma` is the source of truth. Key shapes: `Trip` →
  `ItineraryDay` (`dayIndex`/`order` are Int, **NOT unique** — renumber in a txn) →
  `ScheduleItem` → `ScheduleItemSite` (0 = info line, 1 = stop, many = block).
  `Location` (renamed from `Site`) has a 1:1 `HostSite` extension; `Stay` is per-trip
  lodging; `Region` is a hierarchical catalog. A `Stay` anchors EITHER by calendar
  dates (`checkIn`/`checkOut`) on a dated trip OR by 1-based day indices
  (`checkInDayIndex`/`checkOutDayIndex`) on a date-less template — exactly one mode
  (DB CHECK `stay_anchor_mode`). Templatizing/instantiating a trip converts between
  them (`templatizeStays`/`instantiateStays` in `src/lib/templates.ts`), mirroring
  how `ItineraryDay.date` derives from `startDate + dayIndex`.
- **Travel legs (GH #80)**: a `ScheduleItem` with a 1:1 `TravelLeg` extension IS a
  travel span — origin → destination (`fromLocation`/`toLocation` or free-text
  labels), a `TravelMethod`, ordered `TravelStop`s — with the item's
  `startTime`/`endTime` as depart/arrive. Travel items carry **no**
  `ScheduleItemSite` rows (so they don't join venue runs or feed venue
  engagements; a coach reservation is the ordinary site-less item booking), and
  a fully-timed span gives `computeScheduleGaps` sound boundaries at venue
  transitions — do NOT create paired start-only "Depart"/"Arrive" items. Label
  derives as "Coach to X" (`scheduleItemPrimaryLabel`); route helpers
  (`travelRoute`/`travelDetailLine`) + serialization live in `src/lib/trips.ts`
  (`TRAVEL_LEG_INCLUDE` is the Prisma include every item query spreads). The
  editor has a dedicated `TravelFields` form ("+ Add travel"); legs copy
  verbatim through templatize/instantiate.
- **Bookings = venue engagements**: a `Booking` targets **exactly one of** a `(trip,
  location)` engagement OR a `ScheduleItem` (DB CHECK `num_nonnulls(scheduleItemId,
  tripId) = 1`, plus `tripId ⇒ locationId`). The engagement is the normal case: ONE
  booking per `(trip, location)` (`@@unique([tripId, locationId])`) that **auto-covers
  every schedule item the trip runs at that location, plus any `Stay` there** — so a
  host site visited across many sessions is one booking, not one per session. Lodging
  has **no** booking of its own; the `Stay`'s booking state is its venue engagement.
  The item target is only for **site-less** bookings (a coach, a label-only reservation).
  `Location.bookable` (default true) marks never-bookable walk-by stops (no booking
  allowed; hidden from the dashboard's attention filters); `BookingStatus.NOT_NEEDED`
  is a per-trip "skip this one". Row-building lives in `src/lib/booking-dashboard.ts`
  (`buildDashboardRows`, reused by the single-trip dashboard and `/trips/compare`);
  the inline status control upserts via `upsertVenueBooking`/`setVenueBookingStatus`
  in `src/app/(app)/trips/actions.ts`.
- **Agreed price**: `Booking.agreedAmount` is the engagement TOTAL unless
  `agreedUnit = PER_PERSON`, where it's a rate × the trip headcount
  (`participantCount ?? capacity`, `tripHeadcount`). Legacy `PER_GROUP` and null both
  mean total (the form offers only total / per person and saves total as null). Every
  balance / settled / schedule-percent / Money-panel / MCP calculation goes through
  `agreedTotal()` in `src/lib/costs.ts` (unit-tested) — null for a per-person rate
  with no headcount, treated like no agreed price and flagged "no headcount" in the
  UI. Never use `agreedAmount` as a total directly. Dashboard rows carry both
  `agreedAmount` (as entered) and `agreedTotal`.
- **Payment schedules (GH #51, anchors #86)**: a booking may carry `PaymentScheduleItem`
  installments — EITHER a `percent` of the agreed price (`agreedTotal`) OR a `fixedAmount` (DB CHECK
  `payment_schedule_amount`). The due date is `offsetValue` `offsetUnit`s
  (DAY/WEEK/MONTH, calendar-aware) from a selectable `anchor` (DB CHECK
  `payment_schedule_anchor`: NONE ⇒ offset null, else both set):
  **`EVENT_START`** = offset **before** `trip.startDate` (negative = after; the
  original behavior); **`BOOKING`** = offset **after** the booking's `bookedOn`
  (planner-set date; falls back to `createdAt`); **`NONE`** = no deadline (owed until
  paid, never overdue — a deposit-at-booking with no fixed date; sorts/allocates
  last, so "pay this first" is a `BOOKING` offset 0, not `NONE`). Resolution
  (amounts, due dates via `describeCadence` for the human "rule", earliest-due-first
  ordering + allocation, paid/overdue/upcoming/unscheduled state) is pure in
  `src/lib/payment-schedule.ts` (`resolveSchedule`/`scheduleAttention`, unit-tested);
  every caller passes both `tripStartDate` and `bookingDate` (`bookedOn ?? createdAt`).
  Editing is replace-the-whole-set (`setPaymentSchedule` action, `set-payment-schedule`
  MCP tool; `installmentRows` in `validators/booking.ts` is the shared parsed→row map).
  Surfaces: booking-row schedule editor (anchor/unit selectors + `bookedOn` field) +
  status chips, the dashboard's "Payment overdue" attention filter, the home "Payments
  due" card, and the trip overview **Money** panel (in `trips/[id]/page.tsx`). Schedules
  are anchor-relative, so they templatize/instantiate verbatim (unlike the agreed price,
  which resets); an installment whose anchor date isn't known yet (date-less template,
  no booking date) is "unscheduled".
- **Standing payment terms (GH #86)**: a venue's deposit/balance cadence tends to
  hold year to year, so `Location.defaultPaymentSchedule` (`LocationPaymentScheduleItem`,
  same shape + `location_payment_schedule_amount` CHECK as `PaymentScheduleItem`) is a
  first-class default on the location, like its `Cost` catalog. Editing lives on the
  Location page (`location-payment-terms.tsx`, `setLocationPaymentSchedule` action) +
  `set-location-payment-schedule` MCP tool; read via `get-location`. A NEW venue
  engagement pre-fills its `PaymentScheduleItem` set from these terms — the seeding
  points are `upsertVenueBooking` + `setVenueBookingStatus` (create branch) and
  `createTrip`'s template instantiation (`applyLocationScheduleDefaults`). Precedence:
  **an instantiated template's own schedule wins, then the location default, then
  empty.** Editing the terms never touches existing bookings. Terms carry the same
  `anchor`/`offsetValue`/`offsetUnit` shape (+ `location_payment_schedule_anchor`
  CHECK); a `BOOKING`/`NONE` term resolves per engagement once seeded onto a real
  booking, and like booking schedules a term is "unscheduled" until it lands on one.
- **Booking workflows**: admin-defined milestone ladders (`BookingWorkflow` →
  ordered `BookingWorkflowStep`s, edited at `/admin/workflows`) that a booking moves
  through — "Booking agreement", "Tickets only", "Site visit with meal". A booking
  has at most one (`Booking.workflowId`); ticking a step writes a dated
  `BookingStepCompletion` (planner-editable `completedOn`). `BookingStatus` is now
  coarse — `PLANNED | IN_PROGRESS | CONFIRMED | NOT_NEEDED` — and on a workflow
  booking it is **derived**: each step names the status it reaches (DB CHECK
  `booking_workflow_step_status`: IN_PROGRESS or CONFIRMED), the booking's status is
  the furthest any completed step reaches, and `stageLabel`/`stageOn` = the latest
  step done in workflow order (steps may be ticked out of order). Status + stage are
  **stored** (so filters stay column reads) and recomputed by every write that
  changes them — all such writes go through `src/lib/booking-workflow-sync.ts`
  (MCP-safe; pure resolver `resolveBookingProgress` in `src/lib/booking-workflow.ts`,
  unit-tested). `NOT_NEEDED` is a manual override steps never clear; a booking with
  no workflow takes its status by hand. New bookings start on the location's
  `defaultWorkflowId`, else the global `isDefault` workflow (`seedWorkflowFor`, at
  every create point incl. `ensureVenueEngagement` + template instantiation, where
  the template's own workflow wins and progress resets). The one status UI is
  `WorkflowControl` (`trips/workflow-control.tsx`, catalog via
  `BookingWorkflowsProvider` in the `(app)` layout); the board's per-workflow view
  drags between step columns (`setBookingStage`). The dashboard's **Progress** view
  (`trips/booking-progress.tsx`, `?view=progress`) lists every booking across
  workflows with its full step strip — one-click step toggles, plus multi-select
  "Mark done" matched by step LABEL (`setBookingStepsBulk`), since selected rows
  may follow different workflows. Rough-plan planned locations also
  feed engagement rows (an untimed "planned" session) so a visit can be booked
  before it has a slot.
- **Fixed-time items**: `ScheduleItem.fixedTime` marks times the group doesn't
  control (a public event, a timetabled train). The edit ripple (`cascadeFromEdit`)
  and day slide (`shiftDayItems`) never move a fixed item and STOP at the first one
  they reach; the reorder cascade (`cascadeReorderedTimes`) keeps fixed items' times
  and re-lays only the movable ones. `fixedTimeOverlaps` flags a run that now
  collides with an anchor (surfaced in the toast). On update an omitted `fixedTime`
  leaves it untouched. See `docs/itinerary-time-editing.md`.
- **Day reorder + lodging**: dates belong to day POSITIONS, so reordering days
  redates them; stays don't follow on their own. `staysFollowingDays`
  (`src/lib/stay-shift.ts`, unit-tested) finds stays whose nights' days moved
  together (shift by the same delta) or were split apart (left in place). The
  editor previews this (`previewDayReorder`) and asks before writing; MCP
  `reorder-days` takes `moveStays` / `dryRun`.
- **Location merge**: `src/lib/location-merge.ts` folds a duplicate SOURCE into
  the kept TARGET in one txn and deletes the source — web "Merge into…" in the
  Location page's danger zone (`MergeLocationPanel`) + `merge-locations` MCP tool,
  both preview first (`previewLocationMerge`). Target wins; source fills empty
  fields, long text concatenates (pure `merge*Fields`, unit-tested). Unique
  collisions are resolved, not failed: item/day already at the target drops the
  source row; same-trip engagements fold into the target's booking (payments/
  notes/docs move, further-along status kept, source schedule only if target has
  none, source step completions move when both follow the same workflow, then
  status recomputes); host sites OR together; standing terms adopted only if target has none.
  **When adding a new FK to `Location`, repoint it in `mergeLocations`** or the
  cascade on delete will silently drop that data.
- **Notes / contact log**: `Note` is a polymorphic contact-log entry attaching to
  **exactly one of** Location / Booking / Trip / Stay (DB CHECK
  `num_nonnulls(locationId, bookingId, tripId, stayId) = 1`), with method, linked
  `Contact`, `contactedOn`, follow-up + `dueDate`, and `createdBy`. Reusable
  `<NotesThread>` (`src/app/(app)/notes/`); primary surface is the Location page.
- **Documents / file management**: `Document` is metadata attaching to **exactly
  one of** Location / Booking / Trip / Stay — the same polymorphism as `Note`,
  same CHECK (`document_single_target`) — and the bytes live in a 1:1
  `DocumentBlob` (Postgres `bytea`). **Never select `blob` in a listing**: the
  split exists so document lists stay cheap, and `DOCUMENT_SELECT` in
  `src/lib/documents.ts` is the include every listing spreads. Where a file goes:
  the venue engagement `Booking` for contracts/invoices/confirmations (lodging
  included — a `Stay` has no booking of its own), the `Trip` for participant
  itineraries and rosters, the `Location` for venue paperwork that outlives any
  one trip, the `Stay` for stay-specific sheets. Reusable `<DocumentsPanel>`
  (`src/app/(app)/documents/`) is mounted on the trip page, the Location page,
  every booking row, and each stay in the Lodging panel; `/documents` is the
  library index across all of them. Bytes are immutable — replacing a file means
  a new upload, so `updateDocument` only touches metadata.
- **Document sharing + serving**: `Document.shareAudiences` (a `ShareAudience[]`,
  empty by default) lists the **non-staff** audiences a file is released to; STAFF
  is never stored, because a staff link is the authenticated view under a token
  and sees the trip's whole file set. `shareDocumentWhere` in
  `src/lib/share-documents.ts` is the single gate (scope AND release, both in
  SQL) used by the share page and the share download route — a withheld file is
  never fetched, so it can't leak through the RSC payload the way an unrendered
  prop would. Venue documents are deliberately outside whole-trip share scope
  (a `Location`'s files are global across trips); only a HOST_SITE link scoped to
  that venue reaches them. Two download routes, both returning
  `documentResponse()`: `/api/documents/[id]` (session required, re-checked in
  the route, not just in `src/proxy.ts`) and `/api/share/[token]/documents/[id]`
  (token + audience). Uploads are inert-by-allowlist (`ALLOWED_CONTENT_TYPES` —
  no `text/html`, no `image/svg+xml`) and served with `nosniff` plus
  `Content-Security-Policy: default-src 'none'; sandbox`, since they come off the
  app's own origin.

## Database & migrations

Migrations that touch existing data are **hand-written and data-preserving — do NOT
regenerate them**. Author DDL to the project's conventions, reorder so new tables are
created and backfilled **before** old columns are dropped, and **validate** with a
shadow-DB diff before applying:

```
prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url <throwaway-db-url> --exit-code   # expect "No difference detected"
```

Prisma can't model CHECK constraints, so they're invisible to migrate-diff (e.g. the
`Booking` target CHECKs and the `Note` exactly-one-target CHECK) — verify those
manually. Note a Postgres gotcha for enum changes: `ALTER TYPE … ADD VALUE` must not
be **used** in the same transaction it's added (keep it in its own migration step).
Production applies migrations via `migrate deploy` on container boot.

## Critical gotchas (already solved — do NOT regress)

1. **force-dynamic**: any page reading the DB without cookies (`/login`, `/setup`,
   the trip/share pages) needs `export const dynamic = "force-dynamic"`, else the
   Docker build fails (no `DATABASE_URL` at build time).
2. **Prisma migrate-on-boot** runs from a separate `/prisma-cli` tree (Dockerfile
   `prisma-cli` stage), NOT the standalone `node_modules` — the CLI needs transitive
   deps (`effect`) a selective copy misses. Don't "optimize" it back.
3. **PG18** volume mounts at `/var/lib/postgresql` (not `/data`); named `postgres_data`.
4. **Env values UNQUOTED** in `.env.example` / Dockhand (quotes leak literally).
5. **Serwist + Next 16 Turbopack** conflict: `next.config.ts` only wraps `withSerwist`
   when `NODE_ENV !== "development"`; the build script uses `--webpack`.
6. **Server Action body size**: document uploads ride through a Server Action, whose
   default request cap is 1MB. `next.config.ts` sets
   `experimental.serverActions.bodySizeLimit` to `26mb`, just above the 25MB
   `MAX_DOCUMENT_BYTES` (the extra covers the multipart envelope). Raising one
   without the other silently breaks uploads at the boundary.
7. **react-hooks/purity lint**: no `Date.now()` / `new Date()` in component render
   (even Server Components). Extract to a plain helper (see `isCostStale` in
   `src/lib/money.ts`, `todayUtc` in `src/lib/dates.ts`).

## WP Export API

Read-only JSON export API for server-to-server access (WordPress plugin, third-party integrations).
Authenticated via single shared API key; NOT per-trip share links. Admin UI at `/admin/api-keys`.

### Key management

Keys are opaque `tpk_*` tokens (32 random bytes base64url-encoded). Staff see only the prefix
(first 8 chars after `tpk_`) and a SHA-256 hash (stored in DB). Keys can be:
- **Scoped** by trip type (empty scope = all types)
- **Revoked** (logical delete; read-only archive of key usage)
- **Rotated** via creation + revocation (never hardcoded)

Admin actions:
- Create: returns full key once; display to user immediately; save/copy before leaving
- Revoke: mark inactive; preserves `lastUsedAt` history for audit
- List: shows prefix, scope, created/used dates, status

### Endpoints

- `GET /api/export/v1/trips?tripType=<id|name>&includeArchived=1`
  - List trips accessible to the key, filtered by trip type and status.
  - Query params: `tripType` (comma-separated ID or name filters), `includeArchived` (0/1)
  - Returns: array `[{id, name, tripType:{id, name}, startDate, endDate, status, updatedAt}]`
  - Excludes: templates, CANCELLED (and ARCHIVED unless includeArchived=1)
  - Filtered to key scope: if key scoped to specific trip types, only those are returned

- `GET /api/export/v1/trips/[id]/itinerary`
  - Full itinerary + location catalog + region hierarchy for one trip.
  - Returns: `{schemaVersion:1, trip:{...}, days:[...], locations:{...}, regions:{...}}`
  - ETag support: `If-None-Match` → 304 if unchanged; ETag computed over JSON body only
  - Cache-Control: `private, no-cache` (private to authenticated consumer; no browser cache)
  - Missing/invalid/revoked/out-of-scope key or unknown trip → plain 404

### Payload schema (version 1)

```typescript
{
  schemaVersion: 1,
  trip: {
    id, name, startDate, endDate, status ("ACTIVE"|"ARCHIVED"|"CANCELLED"),
    isTemplate, updatedAt (ISO 8601)
  },
  days: [{
    id, dayIndex, date (ISO), title, participantNotes, cityRegionId,
    stops: [{
      locationId, source ("schedule"|"planned"), startTime (HH:MM), endTime,
      category, itemTitle (null if matches location name)
    }],
    overnight: {locationId} | null
  }],
  locations: {[id]: {
    id, name, regionId, address, description, website, mapHref (computed from
    name/address or mapUrl), placeId (Google place ID | null), lat, lng
    (numbers | null, both-or-neither), providesLodging (HostSite.providesLodging or false),
    archived (archivedAt != null), updatedAt (ISO)
  }},
  regions: {[id]: {
    id, name, parentId, path (full ancestry "England › London › Soho")
  }}
}
```

### Redaction (WP-safe)

NEVER emitted: `logisticalNotes`, notes (day/stay/location/item), contacts, costs,
bookings, payments, raw `mapUrl`, `HostSite` fields, `provideMeals` / `provideMeetingSpace`,
staff-only site extras (phone, internal notes). Locations dict includes only sites
referenced by stops/overnights/day primaryLocations. Regions dict includes every
referenced region plus full ancestor chain (e.g. if an item is in "London", both
London and England are included, with correct `parentId` links).

### Stop deduping & ordering

Per day: schedule items by `order` → item sites by `order` → skip travel legs →
append planned locations not already present. Stops deduped by `locationId` (first
occurrence wins). Travel legs are completely omitted (no locationId, no representation).

### Overnight resolution

Per day: highest-priority covering stay (ties broken by shortest span). Respects both
calendar dates (dated trips) and day indices (templates). Null when no stay covers the night.

### Day city (cityRegionId)

`ItineraryDay.cityRegionId` is the planner-set primary city (a `Region` node; set
in the day editor, `add-day`/`update-day` MCP, copied through templates). The WP
plugin keys its day header off it. Export resolution order:

1. Day's explicit `cityRegionId`
2. Day's primaryLocation.regionId
3. Overnight lodging location.regionId
4. First stop's location.regionId
5. null

### Test fixture

`tests/fixtures/tp-itinerary.json`: realistic Wesley-pilgrimage example (11 days,
Salisbury→Epworth→Oxford→Bristol→London) matching the schema exactly.

## Deploy

Repo `git@github.com:ki4hrg/Tour-Planner.git` (owner `ki4hrg`). Push to `main` →
GitHub Actions → GHCR → Dockhand webhook → host. Images use `pull_policy: always`.
Host: `john@docker-peter.int.fleischauer.net`, stack at `/data/stacks/tour-planner`,
public at **https://tour.fleischauer.net**. After a deploy, the live
`org.opencontainers.image.revision` should equal `git rev-parse HEAD`.
