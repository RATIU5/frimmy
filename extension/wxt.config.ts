import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    action: {}, // no default_popup -> action.onClicked fires in the background
    permissions: ['scripting', 'activeTab', 'cookies'],
    // background fetch to the API needs host access. Tighten to your worker's
    // host once prod is known. ponytail: workers.dev wildcard, narrow later.
    host_permissions: ['https://*.workers.dev/*'],
  },
});
