# Tasks & Todoist — a first-class task substrate (GH #65)

Design pass for #65. Today a "follow-up" is a flag on a `Note`, so every task has to
pretend to be a contact-log entry. This proposes a first-class `Task` that many
**producers** feed — manual entry, note follow-ups, and payment deposits (#86/#51) —
all riding one Todoist bridge. Nothing here is built yet; this is the design to agree
before code, as #65 asks.

## Where we are today

- **`Note`** (`prisma/schema.prisma`) is polymorphic over exactly one of
  Location / Booking / Trip / Stay (DB CHECK `num_nonnulls = 1`) and carries the
  whole follow-up mechanism itself: `followUp`, `dueDate`, `todoistTaskId`,
  `createdBy`.
- **The Todoist bridge** (`src/lib/todoist-sync.ts`) is already the right shape and
  worth preserving wholesale:
  - `syncNoteFollowUp` — flag on + no task → create; on + task → update; off + task
    → close and forget the id. Best-effort (returns a warning string, never throws).
  - `reconcileTodoistFollowUps` — lazy (~60 s throttle via `lastReconciledAt`),
    called from the dashboard render; pulls completions back and clears `followUp`.
  - `closeNoteTaskOnDelete` — close the mirror when the note is deleted.
  - Routing: `resolveTripProject` (trip link → trip-type link → user default →
    Inbox) and `resolveLocationProject`; label `tour-planner`; description = an
    `AUTH_URL` deep link built from `noteTarget()`.
- **Payment schedules** (`PaymentScheduleItem`, and the venue-level
  `LocationPaymentScheduleItem` from #86) resolve to a title-able amount + a due date
  + a booking→trip for routing (`resolveSchedule` in `src/lib/payment-schedule.ts`).
  A deposit is *exactly* "a dated thing that should nudge me and close when handled" —
  but it has no way to become a task today.

So the plumbing is ~80% there. What's missing is the substrate the plumbing should
hang off of, instead of hanging off `Note`.

## Target shape

One `Task` entity. It owns the follow-up concern (due date, done, Todoist mirror);
`Note` goes back to being purely a contact-log entry. Every task carries:

- a **context target** — where it lives (reusing the Note polymorphism), for routing
  and for surfacing it on the right page;
- an optional **producer link** — what generated it, so drift and auto-close can be
  driven from the source.

```prisma
enum TaskSource { MANUAL NOTE INSTALLMENT }

model Task {
  id            String     @id @default(cuid())
  owner         User       @relation("OwnedTasks", fields: [ownerId], references: [id], onDelete: Cascade)
  ownerId       String     // whose task — and whose Todoist account the mirror lives in
  title         String
  detail        String?
  dueDate       DateTime?  @db.Date
  done          Boolean    @default(false)
  doneAt        DateTime?
  source        TaskSource @default(MANUAL)
  todoistTaskId String?

  // Context target — 0 or 1 of these (CHECK num_nonnulls <= 1). Zero = a personal
  // task with no context; routes to the user's default Todoist project.
  location   Location? @relation(fields: [locationId], references: [id], onDelete: Cascade)
  locationId String?
  booking    Booking?  @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  bookingId  String?
  trip       Trip?     @relation(fields: [tripId], references: [id], onDelete: Cascade)
  tripId     String?
  stay       Stay?     @relation(fields: [stayId], references: [id], onDelete: Cascade)
  stayId     String?

  // Producer link — nullable, SetNull (see "Volatility"). A NOTE task points at the
  // note whose follow-up spawned it; an INSTALLMENT task at the deposit.
  note                Note?                @relation(fields: [noteId], references: [id], onDelete: SetNull)
  noteId              String?
  paymentScheduleItem PaymentScheduleItem? @relation(fields: [paymentScheduleItemId], references: [id], onDelete: SetNull)
  paymentScheduleItemId String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([ownerId, done, dueDate])
  @@index([paymentScheduleItemId])
  @@index([noteId])
}
```

Prisma can't model the `num_nonnulls(...) <= 1` CHECK on the four context FKs — add
it by hand in the migration, same as the `Note` and `Booking` target CHECKs.

## The two decisions #65 flagged, settled

### 1. Ownership is per-user

A `todoistTaskId` is only meaningful inside **one** person's Todoist account, so a
Task has a single `ownerId` (the person who wants the nudge), mirroring how
`TripTodoistLink` is per-user. This is *not* the same as who acts on it:

- **Ownership** governs which Todoist account the mirror lives in.
- **Close triggers are global.** When planner B logs a payment that covers a deposit,
  we close **every** Task pointing at that installment — including planner A's —
  because the trigger keys off the producer's state, not the task's owner.

Multiple people wanting their own nudge for the same deposit → multiple Tasks, one per
owner, all pointing at the same `paymentScheduleItemId`. Multi-**assignee** single
tasks (Todoist shared-project assignment) are explicitly deferred.

### 2. Producer volatility → SetNull + an id-preserving schedule editor

Installments are edited **replace-the-whole-set** (`setPaymentSchedule` /
`setLocationDefaultPaymentSchedule` do `deleteMany` + `createMany`). If a Task's
`paymentScheduleItemId` cascaded, every ordinary schedule edit would silently delete
the deposit's task. Two-part fix:

- **`onDelete: SetNull`** on the producer FK. A genuinely-removed installment leaves
  its Task behind as a now-sourceless task (surfaced as "source removed"), not a
  silent disappearance — the owner decides to keep or dismiss it.
- **Make the schedule editor id-preserving** — switch `setPaymentSchedule` from
  delete-all/recreate to a diff by `id` (update surviving rows, create new, delete
  only removed). The editor already round-trips installment `id`s in its resolved
  data, so this is contained. Ordinary edits (tweak a percentage, move an offset) then
  never touch the FK, and only a real deletion trips SetNull.

## Producers

All three write a `Task` and let the one bridge handle Todoist.

- **Manual** (`source: MANUAL`) — a "New task" form on the trip and location pages
  (and eventually a global one). Owner = current user; target = that page's entity.
- **Note follow-up** (`source: NOTE`) — the Note form's follow-up checkbox stops
  writing `Note.followUp` and instead creates/updates a Task (`noteId` set, target
  copied from the note). Toggling it off marks the Task done. This is the migration
  of the *existing* behaviour (Phase 2 below).
- **Deposit installment** (`source: INSTALLMENT`) — opt-in "Remind me" on an
  installment row. Owner = the planner who flips it; target = the booking; title e.g.
  `Deposit — {venue} · {trip}: {amount}`; `dueDate` = the resolved installment due
  date. **Drift:** on schedule save or a trip-date change, update the linked Tasks'
  title + due. **Auto-close:** `addPayment` that covers the installment marks its
  Tasks done and closes the mirrors (best-effort, immediate). Completing the task in
  Todoist just clears it — it never fabricates a `Payment`; paying stays explicit.
  Location default terms are unresolved, so they never produce tasks — only a schedule
  seeded onto a dated booking does.

## Generalizing the bridge

A near-mechanical rename of `todoist-sync.ts`, keeping every behaviour:

- `syncNoteFollowUp(userId, noteId)` → `syncTask(taskId)` — reads the Task, uses
  `owner`'s token, create/update/close on `done`.
- `reconcileTodoistFollowUps(userId)` → `reconcileTasks(userId)` — same lazy throttle,
  now over the owner's open Tasks; completed-in-Todoist → `done`.
- `closeNoteTaskOnDelete` → `closeTaskMirrorOnDelete`.
- `noteTarget()` → `taskTarget()` — same label/href logic (add installment → the
  booking dashboard href). Routing (`resolveTripProject` / `resolveLocationProject`)
  is reused unchanged: it already keys off the context target, which Task carries.
- New: a producer-driven close path invoked from `addPayment` (and the schedule
  editor) so payment state, not just Todoist, closes deposit tasks.

## Migration strategy (data-preserving, phased)

The end-state removes the follow-up columns from `Note`. That's a data migration, so
it's **additive-first, drop-later**, per the repo's migration rules.

1. **Additive** — create `Task` + `TaskSource` + the four context FKs + producer FKs +
   the `num_nonnulls <= 1` CHECK. New table only; nothing on `Note` touched yet.
2. **Backfill** — one hand-written `INSERT ... SELECT` from every `Note WHERE followUp
   = true`: `ownerId ← createdById`, `dueDate`/`todoistTaskId` carried, context FK
   copied across, `source = NOTE`, `noteId = Note.id`, `title` = first line of `body`
   (rest → `detail`). Verify counts before proceeding.
3. **Cut over code** in the same release as the backfill: the Note form writes Tasks;
   the dashboard/home cards read Tasks; the bridge runs over Tasks. Ordering so new
   table is built + backfilled **before** old columns are read-from is what keeps the
   lazy reconcile working across the switch.
4. **Drop** `Note.followUp` / `dueDate` / `todoistTaskId` in a **later** migration,
   once no code reads them. CHECK constraints hand-verified with the shadow-DB diff
   recipe (they're invisible to `migrate diff`).

### Phasing so each PR is reviewable

- **Phase 1 — substrate + new producers.** Build `Task`, the generalized bridge
  (running *alongside* the Note one), the id-preserving schedule editor, and the two
  *new* producers (manual + deposit). Note follow-ups stay on their existing path.
  Ships the deposit feature you actually asked for, with no risky data migration.
- **Phase 2 — fold in notes.** Migrate note follow-ups into Task (steps 2–4 above),
  retire `syncNoteFollowUp`, drop the Note columns. Pure consolidation, no new UX.

Phase 1 is the same deliverable as the "targeted deposit bridge" would have been —
but built on the general substrate, so Phase 2 is consolidation rather than a rewrite.

## Surfaces

- Home **"Follow-ups due"** card → **"Tasks due"** (query `Task`, not `Note`).
- Trip & location pages get an **open-tasks** list + the "New task" form (#65's core
  ask). The trip wrap-up card's "Open follow-ups" reads Tasks.
- Booking dashboard already has the "Payment overdue" attention filter (#86); a
  deposit Task is the actionable companion to it.
- MCP: `list-tasks` (V) / `add-task` (P) / `complete-task` (P), and a `remind`
  flag on the installment write tools. Mirrors the existing `add-note` shape.

## Open questions / explicitly deferred

- **Shared/assignee tasks** — one task assigned across planners via a Todoist shared
  project. Deferred; per-user Tasks cover the near term.
- **Recurring tasks & priorities** — Todoist supports both; out of scope until asked.
- **Completing a deposit task ⇒ log a payment?** No — kept one-way on purpose. The
  payment log stays the source of truth; the task closes *from* a logged payment, not
  the reverse.
- **Near-real-time close** — the lazy reconcile stays; Todoist OAuth + webhooks (#62)
  would tighten it but aren't a prerequisite.
