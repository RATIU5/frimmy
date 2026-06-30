# Frimmy

Point at any element on a web page, describe the change in plain English, and watch the CSS rewrite itself. Share a URL and anyone can see your edits live on the same page.

https://github.com/user-attachments/assets/ad5267e1-3a91-42f1-9602-b91b2dc621c7

> [!NOTE]
> This project was created within 6 hours from idea to working prototype as a test to see how fast I can get a project up and running, with the assistance of AI (Claude Code). All chat history with the AI has been recorded.

Built on a WXT browser extension talking to a Cloudflare Worker (D1 + KV, gated by Access) — natural-language CSS editing, persisted and shareable by link.

## Setup

Workspace monorepo: `extension/` (WXT browser extension) + `server/`
(Cloudflare Worker). Works with any Node package manager — `npm`, `pnpm`,
`yarn`, or `bun` (Node >= 18). Examples below use `npm`; substitute your own.
Assumes the Cloudflare resources (D1, KV, Access) already exist on the account
— their ids are committed in `server/wrangler.jsonc`.

```sh
# 1. Clone + install all workspaces from the repo root
git clone <repo-url> frimmy && cd frimmy
npm install                          # or: pnpm install / yarn / bun install

# 2. Authenticate Wrangler with your Cloudflare account
cd server
npx wrangler login
npm run cf-typegen                    # generate binding types
npx wrangler d1 migrations apply frimmy --local   # seed local dev DB

# 4. Setup extension project
# If you a chromium browser other than Chrome (I use Arc), you'll need to set add the following file:
cd ../extension
cat > web-ext.config.ts <<'EOF'
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  disabled: true,
  binaries: {
    chrome: '/Applications/Arc.app/Contents/MacOS/Arc',
  },
});
EOF
```

Run everything (both dev servers) from the repo root:

```sh
npm run dev          # extension (WXT) + server (Worker) together, via concurrently
```

Or individually:

```sh
npm run dev -w frimmy-server       # Worker at http://localhost:8787
npm run dev -w frimmy-extension    # WXT dev browser
# pnpm:  pnpm --filter frimmy-server dev   |  bun: bun run --filter frimmy-server dev
```

Per-package details: [`extension/README.md`](extension/README.md),
[`server/README.md`](server/README.md). Secrets (e.g. Access service token) go
in `server/.dev.vars` locally — see the server README.

## Timeline

Idea to working prototype in 6 hours, AI-assisted (Claude Code), full chat history and commit timestamps recorded.

- `19:30 · 2026-06-29` — Project start: WXT template, scaffolding, design notes
- `21:45 · 2026-06-29` — Cloudflare project + Worker wired up
- `07:30 · 2026-06-30` — Hono server MVP
- `10:30 · 2026-06-30` — Working prototype
- `15:50 · 2026-06-30` — Final edits within allotted time
