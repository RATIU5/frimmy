// Lightweight gate that runs on every page. No React, no network, no auth:
// it only looks at the URL (shared `?frimmy=` link, or a local index of pages
// we've saved edits for) and, if there's something to load, shows a small
// Yes/No banner. "Yes" tells the background to inject the full panel, which
// then applies the edits.
export default defineContentScript({
	matches: ["<all_urls>"],
	runAt: "document_idle",
	async main() {
		const url = location.origin + location.pathname;
		const shared = new URLSearchParams(location.search).has("frimmy");
		const res = shared
			? { has: true }
			: ((await browser.runtime.sendMessage({ type: "has-edits", url })) as {
					has?: boolean;
				});
		if (!res?.has) return;

		const bar = document.createElement("div");
		bar.attachShadow({ mode: "open" }).innerHTML = `
			<style>
				.b { position: fixed; bottom: 16px; left: 16px; z-index: 2147483647;
					display: flex; gap: 8px; align-items: center; padding: 10px 12px;
					font: 14px system-ui, sans-serif; color: #111; background: #fff;
					border: 1px solid #ddd; border-radius: 10px;
					box-shadow: 0 8px 24px rgba(0,0,0,.18); }
				button { border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; }
				.y { background: #1a73e8; color: #fff; }
				.n { background: #eee; }
			</style>
			<div class="b">Frimmy has edits for this page. Load them?
				<button class="y">Yes</button><button class="n">No</button>
			</div>`;
		document.body.append(bar);
		const sr = bar.shadowRoot!;
		sr.querySelector(".y")!.addEventListener("click", () => {
			browser.runtime.sendMessage({ type: "inject-frimmy" });
			bar.remove();
		});
		sr.querySelector(".n")!.addEventListener("click", () => bar.remove());
	},
});
