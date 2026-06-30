// Icon click: first time on a tab -> inject the panel; after that -> just
// (re)activate the picker. Stateless: we probe by messaging the tab. If nothing
// answers, the script isn't there, so inject it (it self-activates on load).
//
// All network lives here, not the content script: Chrome enforces CORS on
// content-script fetches, and the auth token never touches the page.

const API = import.meta.env.WXT_API_URL; // e.g. https://server.you.workers.dev

// Auth = Cloudflare Access. After the user logs in (IdP), Access sets a
// `CF_Authorization` cookie on the API host whose value IS the Access JWT the
// server verifies. No token -> not authenticated -> open the API in a tab so
// Access shows its login. ponytail: cookie-as-token, swap to launchWebAuthFlow only if a cookie-less flow is needed.
async function accessToken(): Promise<string | undefined> {
  const c = await browser.cookies.get({ url: API, name: 'CF_Authorization' });
  return c?.value;
}

class AuthRequired extends Error {}

// One login tab at a time. Concurrent calls failing auth (e.g. load-state on
// mount + a chat submit) would each open a tab; gate so only the first does,
// for a short window. ponytail: time guard, not tracking the actual tab.
let lastAuthTab = 0;
async function openLogin() {
  const now = Date.now();
  if (now - lastAuthTab < 10000) return; // a login tab was just opened
  lastAuthTab = now;
  await browser.tabs.create({ url: API });
}

async function api(path: string, body?: unknown, method = 'POST') {
  if (!API)
    throw new Error('Extension not configured: WXT_API_URL is unset. Set it in .env and rebuild.');
  const token = await accessToken();
  if (!token) {
    await openLogin(); // Access intercepts -> login
    throw new AuthRequired('Sign in to Cloudflare Access (a tab was opened), then try again.');
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    await openLogin();
    throw new AuthRequired('Session expired — sign in again in the opened tab, then try again.');
  }
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => null))?.error?.message ?? `HTTP ${res.status}`,
    );
  if (res.status === 204) return null; // No Content (e.g. DELETE)
  return res.json();
}

function handle(promise: Promise<unknown>, sendResponse: (r: unknown) => void) {
  promise
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e.message ?? e), authRequired: e instanceof AuthRequired }));
}

// Inject the panel; if it's already there, just (re)activate the picker.
async function injectPanel(tabId: number) {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'activate-picker' });
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
  }
}

// Local index of URLs we've saved edits for, so the lightweight auto script can
// check "any edits here?" with zero network and no auth.
const URLS_KEY = 'frimmy-urls';
async function getUrls(): Promise<string[]> {
  const res = await browser.storage.local.get(URLS_KEY);
  return (res[URLS_KEY] as string[] | undefined) ?? [];
}
async function recordUrl(url: string) {
  const urls = await getUrls();
  if (!urls.includes(url))
    await browser.storage.local.set({ [URLS_KEY]: [...urls, url] });
}

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) injectPanel(tab.id);
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'has-edits') {
      getUrls().then((urls) => sendResponse({ has: urls.includes(msg.url) }));
      return true;
    }
    if (msg?.type === 'inject-frimmy') {
      if (sender.tab?.id) injectPanel(sender.tab.id);
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'ai-edit') {
      handle(api('/ai/edit', { prompt: msg.prompt, context: msg.context, selector: msg.selector }), sendResponse);
      return true; // async response
    }
    if (msg?.type === 'get-edit') {
      handle(api(`/edits/${encodeURIComponent(msg.id)}`, undefined, 'GET'), sendResponse);
      return true;
    }
    if (msg?.type === 'load-state') {
      handle(api(`/state?url=${encodeURIComponent(msg.url)}`, undefined, 'GET'), sendResponse);
      return true;
    }
    if (msg?.type === 'clear-state') {
      getUrls().then((urls) =>
        browser.storage.local.set({ [URLS_KEY]: urls.filter((u) => u !== msg.url) }),
      );
      handle(api(`/state?url=${encodeURIComponent(msg.url)}`, undefined, 'DELETE'), sendResponse);
      return true;
    }
    if (msg?.type === 'save-state') {
      recordUrl(msg.url);
      handle(api('/state', { url: msg.url, state: msg.state }, 'PUT'), sendResponse);
      return true;
    }
    if (msg?.type === 'save-edit') {
      handle(
        api('/edits', { diff: msg.diff, target_url: msg.target_url, title: msg.title }),
        sendResponse,
      );
      return true;
    }
    if (msg?.type === 'delete-edit') {
      handle(api(`/edits/${encodeURIComponent(msg.id)}`, undefined, 'DELETE'), sendResponse);
      return true;
    }
    if (msg?.type === 'update-edit') {
      handle(
        api(
          `/edits/${encodeURIComponent(msg.id)}`,
          { diff: msg.diff, target_url: msg.target_url, title: msg.title },
          'PUT',
        ),
        sendResponse,
      );
      return true;
    }
  });
});
