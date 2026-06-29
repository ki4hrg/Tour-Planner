@AGENTS.md

## MCP Server

Remote MCP endpoint at `/api/mcp` (Streamable HTTP). OAuth 2.1 at `/api/oauth/*`.
Discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
(served via rewrites in `next.config.ts` to `/api/well-known/*`).

### Adding a new MCP tool

1. Create or extend a file in `src/lib/mcp/tools/`.
2. Export a `register*Tools(server: McpServer, user: SessionUser)` function.
3. Register tools with `server.tool(name, description, zodSchema, handler)`.
   The schema argument is a plain object of Zod shapes (e.g. `{ tripId: z.string() }`), NOT wrapped in `z.object()`.
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
