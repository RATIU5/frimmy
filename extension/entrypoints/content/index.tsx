import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

// registration: 'runtime' -> NOT in the manifest, so it never auto-loads on every
// page. The background injects it on the first icon click via scripting.executeScript.
export default defineContentScript({
	matches: ["<all_urls>"],
	registration: "runtime",
	cssInjectionMode: "ui", // styles go into the shadow root, isolated from the page
	async main(ctx) {
		const ui = await createShadowRootUi(ctx, {
			name: "frimmy-panel",
			position: "inline",
			anchor: "body",
			onMount(container) {
				const root = ReactDOM.createRoot(container);
				root.render(<App host="frimmy-panel" />);
				return root;
			},
			onRemove(root) {
				root?.unmount();
			},
		});
		ui.mount();
	},
});
