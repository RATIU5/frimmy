# Technical Spec — Frimmy Server (Cloudflare Workers)

## Goal
A stateless REST API on Cloudflare Workers backing the Frimmy extension:
authenticated users save natural-language page edits (stored as diffs),
generate those diffs via Workers AI, and share them via URL to other
authenticated users.

## Constraints
- **Platform:** Cloudflare Workers only — Workers (routing/API), Workers AI
  (NL→diff), **D1** (users, ownership, edit metadata), **KV** (diff blobs
  keyed by id).
- **Clients:** WXT browser extension. No traditional server session store —
  auth must be stateless.
- **Scale:** Solo-account stage; design must not block adding orgs/teams later.

## Approach

### Auth — OAuth + JWT (stateless)
- OAuth (Google/GitHub) → Worker issues a signed JWT (HS256/EdDSA) stored by
  the extension, sent as `Bearer`.
- Worker verifies JWT per request; no session store. `sub` = user id.
- Solo accounts now; `user` row carries a nullable `org_id` for the future org
  layer (don't build org tables yet).

### Storage split
- **D1:** `users`, `edits` (id, owner_id, target_url, created_at, title).
  Queryable → powers "list my edits".
- **KV:** diff blob keyed by edit id. Big/opaque, no querying needed.

### REST surface
All JSON, auth required except the OAuth callback.

- `GET  /auth/login` → OAuth redirect
- `GET  /auth/callback` → issue JWT
- `GET  /auth/me`
- `POST /ai/edit` → NL prompt + page context → Workers AI → diff (rate-limited)
- `POST /edits` → diff→KV, metadata→D1
- `GET  /edits` → list mine
- `GET  /edits/:id`
- `PUT  /edits/:id`
- `DELETE /edits/:id`

### Sharing — auth-gated capability
- Share URL references an edit id (query param). Extension checks auth first;
  if not authenticated, it **ignores** the edit params (no public read).
- `GET /edits/:id` enforces auth. Ownership check deferred — any authed user
  can view a shared id, which is what "auth-required viewing" implies. Tighten
  with an ACL later if needed.

### Abuse defense
- **Workers AI cost:** rate-limit `POST /ai/edit` per-user via the Workers
  **Rate Limiting binding** (or D1/KV counter). JWT requirement already gates
  "who".
- **Scraping:** read endpoints are auth-gated, so no public surface to scrape.
  Cloudflare **Bot Fight Mode + WAF managed rules + AI-crawler blocking** at
  the edge — platform config, ~zero app code.

## Non-goals (ruled out)
- Anonymous / public capability URLs — replaced by auth-required viewing.
- Org/team tables, roles, invites — solo accounts only for v1 (leave `org_id`
  seam).
- KV-only manual index keys — D1 handles listing.
- Turnstile — JWT + rate limiting covers AI abuse; reads aren't public.
- App-level scrape heuristics — Cloudflare edge handles it.

## Open questions
1. **JWT lifetime / refresh** — short-lived + refresh token, or long-lived
   token with silent re-auth? (Affects logout/revocation.)
2. **`/ai/edit` page context** — full page HTML to the Worker, or just the
   selected element + prompt? (Payload size + privacy.)
3. **Diff format** — what does js-element-picker emit, and is the diff a DOM
   patch, CSS override, or serialized element replacement? (Shapes KV blob +
   apply logic.)
