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

## Develop

```sh
bun run dev        # http://localhost:8787 — emulates D1, KV, AI
bun run deploy
```

Type bindings via the generic:

```ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```
