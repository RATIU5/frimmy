# Frimmy Server

Stateless REST API on Cloudflare Workers (Hono). D1 = metadata, KV = diff blobs,
Workers AI = NL→CSS-override diffs, Cloudflare Access = auth. See
[`../docs/specs/SPEC_SERVER.md`](../docs/specs/SPEC_SERVER.md).

## First-time setup

```sh
bun install

# 1. Create the data stores (one-time). Paste the printed ids into wrangler.jsonc.
wrangler d1 create frimmy            # -> d1_databases[].database_id
wrangler kv namespace create DIFFS   # -> kv_namespaces[].id

# 2. Apply DB schema
wrangler d1 migrations apply frimmy --local    # local dev DB
wrangler d1 migrations apply frimmy --remote    # prod (when deploying)

# 3. Generate binding types (run again after changing wrangler.jsonc)
bun run cf-typegen
```

Secrets (if any) go in `.dev.vars` for local dev or `wrangler secret put` for prod.

### Auth — Cloudflare Access

Auth is handled by Cloudflare Access. Create a self-hosted
Access application over the Worker's route, then set in `wrangler.jsonc` `vars`:

- `ACCESS_TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com`
- `ACCESS_AUD` — the application's Audience (AUD) tag

The Worker verifies the `Cf-Access-Jwt-Assertion` header against
`<team>.cloudflareaccess.com/cdn-cgi/access/certs` (use `jose`). No login/callback
routes needed.

## API

All routes require a valid Cloudflare Access JWT in `Cf-Access-Jwt-Assertion`.
JSON in/out. Errors: `{ "error": { "message": string } }`.

| Method | Path          | Body                              | Notes |
| ------ | ------------- | --------------------------------- | ----- |
| GET    | `/auth/me`    | —                                 | verified identity `{id,email}` |
| POST   | `/ai/edit`    | `{prompt, context?}`              | Workers AI → `{css}`; rate-limited per user (RL binding, 20/60s) |
| POST   | `/edits`      | `{diff, target_url, title?}`      | KV blob written first, then D1 row → `{id}` (201) |
| GET    | `/edits`      | —                                 | list mine, newest first |
| GET    | `/edits/:id`  | —                                 | any authed user can read (shared ids) → metadata + `diff` |
| PUT    | `/edits/:id`  | `{diff?, target_url?, title?}`    | owner only |
| DELETE | `/edits/:id`  | —                                 | owner only (204) |

## Develop & test

```sh
bun run dev        # http://localhost:8787 — emulates D1, KV; AI hits the real binding
bun run test       # vitest in the Workers runtime; real D1/KV + real JWT verification
bun run deploy
```

Tests mint a real RS256 JWT and mock only the Access JWKS endpoint, so the
actual `jwtVerify` path is exercised. **There is no auth bypass in the code** —
every request must carry a valid Access token, in tests and in production alike.

## Manual API testing (Postman / curl)

`wrangler dev` runs the Worker *without* Cloudflare Access in front of it, so you
must supply a real Access JWT yourself:

1. Deploy an Access self-hosted app over your prod route (see below), then in a
   browser log in once at that route. Copy the `CF_Authorization` cookie value —
   that's the JWT.
2. Send it as a header to local or prod:
   ```sh
   curl https://localhost:8787/auth/me -H "Cf-Access-Jwt-Assertion: <jwt>"
   ```
   In Postman: add header `Cf-Access-Jwt-Assertion` = the JWT.
   - For automated/extension clients, use an Access **service token**
     (`CF-Access-Client-Id` / `CF-Access-Client-Secret`); Access mints the JWT
     at the edge for the deployed Worker.

Tokens expire (Access session lifetime) — re-grab when you get a 401.

## Manual Cloudflare dashboard work (one-time)

1. **Deploy first** (`bun run deploy`) so the Worker has a route/hostname.
2. **Zero Trust → Access → Applications → Add → Self-hosted**: cover the Worker's
   hostname/path. Add a login method (Google/GitHub/OTP) and an allow policy
   (e.g. emails ending `@yourdomain` or just your email). Save.
3. Copy the application's **Audience (AUD) tag** → `ACCESS_AUD` in
   `wrangler.jsonc`. Confirm `ACCESS_TEAM_DOMAIN` = `https://<team>.cloudflareaccess.com`.
   Redeploy.
4. **Service token** (for the extension/Postman): Access → Service Auth → create
   token; add an Access policy on the app that allows that service token.
5. **Rate limiting** is the `RL` binding (in code) — no dashboard step.
6. Later (hardening, per spec §Stage 2): Super Bot Fight Mode with a Skip rule on
   the API path, and an AI Gateway spend cap. Not needed to start.

Type bindings via the generic:

```ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
