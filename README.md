# Frimmy

> [!NOTE]
> This project was created within ~6 hours from idea to working prototype as a test to see how fast I can get a project up and running, with the assistance of AI (Claude Code). All chat history has been recorded.

A browser extension that allows a user to select a part of a web page and modify it's CSS using natural language. Users can then share their edits with other users by sharing a unique URL so they can visualize their edits.

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

## Process

I am giving myself 6 hours to see how far I can take this project. Everything will be documented, including my AI history and timestamps via git commits.

After 6 hours, I will submit a PR with all my work. After that I will make updates as needed.

## Progress

Breaks have been taken throughout, but time was tracked on a timer.

- [19:30 MT 2026-06-29] Start project, initialize WXT project template, write markdown files
- [21:45 MT 2026-06-29] Setup basic server and setup cloudflare project & workers
- [07:30 MT 2026-06-30] Basic hono server MVP completed
- [10:30 MT 2026-06-30] Prototype is working
