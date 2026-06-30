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

async function api(path: string, body: unknown) {
  const token = await accessToken();
  if (!token) {
    await browser.tabs.create({ url: API }); // Access intercepts -> login
    throw new AuthRequired('Sign in to Cloudflare Access (a tab was opened), then try again.');
  }
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    await browser.tabs.create({ url: API });
    throw new AuthRequired('Session expired — sign in again in the opened tab, then try again.');
  }
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => null))?.error?.message ?? `HTTP ${res.status}`,
    );
  return res.json();
}

function handle(promise: Promise<unknown>, sendResponse: (r: unknown) => void) {
  promise
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e.message ?? e), authRequired: e instanceof AuthRequired }));
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: 'activate-picker' });
    } catch {
      // No receiver -> inject. WXT outputs the content script here; it self-activates.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    }
  });

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ai-edit') {
      handle(api('/ai/edit', { prompt: msg.prompt, context: msg.context }), sendResponse);
      return true; // async response
    }
    if (msg?.type === 'save-edit') {
      handle(
        api('/edits', { diff: msg.diff, target_url: msg.target_url, title: msg.title }),
        sendResponse,
      );
      return true;
    }
  });
});
