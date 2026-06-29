@AGENTS.md

## MCP Server

Remote MCP endpoint at `/api/mcp` (Streamable HTTP). OAuth 2.1 at `/api/oauth/*`.
Discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
(served via rewrites in `next.config.ts` to `/api/well-known/*`).

The `/api/mcp` route creates a fresh `WebStandardStreamableHTTPServerTransport` per request
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

### OAuth

- Access tokens: JWTs signed with `AUTH_SECRET` (HS256), audience `tour-planner-mcp`, 1-hour TTL.
- Auth codes: single-use, 10-minute TTL, stored in `OAuthAuthorizationCode` table.
- Dynamic client registration at `/api/oauth/register` (RFC 7591).
- PKCE S256 is mandatory (OAuth 2.1).
- Scope-to-role mapping: VIEWER → `mcp:read`, PLANNER → `mcp:read mcp:write`, ADMIN → `mcp:read mcp:write mcp:admin`.
- The authorize endpoint (`/api/oauth/authorize`) renders a minimal HTML login form — not the React app login page.
- OAuth/MCP routes are excluded from the auth middleware in `src/proxy.ts`.

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
  `/api/{auth,mcp,oauth,well-known}`. The `src/proxy.ts` matcher excludes those + assets.
- **Data model**: `prisma/schema.prisma` is the source of truth. Key shapes: `Trip` →
  `ItineraryDay` (`dayIndex`/`order` are Int, **NOT unique** — renumber in a txn) →
  `ScheduleItem` → `ScheduleItemSite` (0 = info line, 1 = stop, many = block) +
  `Booking` (targets item XOR stay). `Location` (renamed from `Site`) has a 1:1
  `HostSite` extension; `Stay` is per-trip lodging; `Region` is a hierarchical catalog.

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
`Booking` item-XOR-stay CHECK) — verify those manually. Production applies migrations
via `migrate deploy` on container boot.

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
6. **react-hooks/purity lint**: no `Date.now()` / `new Date()` in component render
   (even Server Components). Extract to a plain helper (see `isCostStale` in
   `src/lib/money.ts`, `todayUtc` in `src/lib/dates.ts`).

## Deploy

Repo `git@github.com:ki4hrg/Tour-Planner.git` (owner `ki4hrg`). Push to `main` →
GitHub Actions → GHCR → Dockhand webhook → host. Images use `pull_policy: always`.
Host: `john@docker-peter.int.fleischauer.net`, stack at `/data/stacks/tour-planner`,
public at **https://tour.fleischauer.net**. After a deploy, the live
`org.opencontainers.image.revision` should equal `git rev-parse HEAD`.
