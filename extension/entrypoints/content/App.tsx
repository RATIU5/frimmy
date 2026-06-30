import { ElementPicker } from "js-element-picker";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant" | "error"; text: string; css?: string };

// Stable-ish selector for the picked element. ponytail: id / nth-of-type path,
// good enough to give the AI a target; swap for a `finder` lib if it proves brittle.
function cssPath(el: Element): string {
	if (el.id) return `#${CSS.escape(el.id)}`;
	const parts: string[] = [];
	let node: Element | null = el;
	while (node && node.nodeType === 1 && node.tagName !== "BODY") {
		let part = node.tagName.toLowerCase();
		const sibs = node.parentElement
			? [...node.parentElement.children].filter(
					(c) => c.tagName === node!.tagName,
				)
			: [];
		if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
		parts.unshift(part);
		node = node.parentElement;
	}
	return parts.join(" > ");
}

// Merge two `selector { ... }` rules, new declarations winning per-property, so a
// follow-up edit adds to the element instead of replacing it. ponytail: regex split
// is fine for the flat declaration blocks the AI returns (no nested {}/@rules).
function mergeRule(selector: string, prior: string | undefined, next: string): string {
	const decls = new Map<string, string>();
	for (const rule of [prior ?? "", next]) {
		const body = rule.match(/\{([^}]*)\}/)?.[1] ?? rule;
		for (const part of body.split(";")) {
			const i = part.indexOf(":");
			if (i === -1) continue;
			const prop = part.slice(0, i).trim();
			if (prop) decls.set(prop, part.slice(i + 1).trim());
		}
	}
	const joined = [...decls].map(([p, v]) => `${p}: ${v};`).join(" ");
	return `${selector} { ${joined} }`;
}

// One <style> in the page's light DOM carries every applied edit; replacing its
// text re-applies. The panel's own styles live in the shadow root, untouched.
function applyCss(css: string) {
	let style = document.getElementById(
		"frimmy-style",
	) as HTMLStyleElement | null;
	if (!style) {
		style = document.createElement("style");
		style.id = "frimmy-style";
		document.head.append(style);
	}
	style.textContent = css;
}

const GREETING: Msg = {
	role: "assistant",
	text: "Hey, I'm Frimmy! Select an element and describe your changes.",
};

export default function App({ host }: { host: string }) {
	const [messages, setMessages] = useState<Msg[]>([GREETING]);
	const [input, setInput] = useState("");
	const [selected, setSelected] = useState<{
		selector: string;
		html: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	// Transient "Copied ✓" feedback on the Save button.
	const [saved, setSaved] = useState(false);
	// Per-element edits, keyed by selector. Persisted server-side per URL.
	const [edits, setEdits] = useState<Record<string, string>>({});
	// The shared-session id this panel is bound to. Set when loaded via ?frimmy=,
	// or after the first Save. Subsequent saves update this same record.
	const [sessionId, setSessionId] = useState<string | null>(null);
	const pickerRef = useRef<ElementPicker | null>(null);
	const logRef = useRef<HTMLDivElement | null>(null);
	// Auto-scroll the chat to the bottom on new messages, unless the user has
	// scrolled up to read history (within 40px of the bottom counts as "at bottom").
	useEffect(() => {
		const el = logRef.current;
		if (!el) return;
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 40)
			el.scrollTop = el.scrollHeight;
	}, [messages, busy]);
	// Don't persist until the initial server load lands, or we'd overwrite saved
	// state with the empty defaults above.
	const loaded = useRef(false);
	const stateUrl = location.origin + location.pathname;

	// Restore on mount: this URL's saved chat+edits first, then overlay a shared
	// (?frimmy=<id>) blob if present. Sequenced — not two racing effects — so an
	// empty saved state can never clobber the restored conversation.
	useEffect(() => {
		(async () => {
			const s: any = await browser.runtime.sendMessage({
				type: "load-state",
				url: stateUrl,
			});
			let msgs: Msg[] = Array.isArray(s?.messages) ? s.messages : [];
			let eds: Record<string, string> =
				s?.edits && typeof s.edits === "object" ? s.edits : {};

			const id = new URLSearchParams(location.search).get("frimmy");
			if (id) {
				setSessionId(id); // bind this panel to the shared session.
				const res: any = await browser.runtime.sendMessage({
					type: "get-edit",
					id,
				});
				if (typeof res?.diff === "string") {
					try {
						const blob = JSON.parse(res.diff);
						if (blob?.edits && typeof blob.edits === "object")
							eds = { ...eds, ...blob.edits };
						// Keep the user's own history if they already had some here.
						if (!msgs.length && Array.isArray(blob?.messages))
							msgs = blob.messages;
					} catch {
						// Legacy share: diff was raw CSS, not JSON.
						eds = { ...eds, [`shared:${id}`]: res.diff };
					}
				}
			}

			// Greeting is always the first message; drop any persisted copy to avoid dupes.
			setMessages([GREETING, ...msgs.filter((m) => m.text !== GREETING.text)]);
			setEdits(eds);
			loaded.current = true;
		})();
	}, [stateUrl]);

	// Re-apply the combined stylesheet whenever edits change, and persist state.
	useEffect(() => {
		applyCss(Object.values(edits).join("\n\n"));
		// Skip the empty case so Clear's delete isn't immediately re-saved.
		if (loaded.current && (messages.length > 1 || Object.keys(edits).length)) {
			browser.runtime.sendMessage({
				type: "save-state",
				url: stateUrl,
				state: { messages, edits },
			});
			// Bound to a shared session -> keep its DB record current so reloading
			// the ?frimmy= link shows the latest edits, not a stale snapshot.
			// ponytail: writes on every change; debounce if it gets chatty.
			if (sessionId) {
				const css = Object.values(edits).join("\n\n");
				browser.runtime.sendMessage({
					type: "update-edit",
					id: sessionId,
					diff: JSON.stringify({ css, messages, edits }),
					target_url: location.href,
					title: document.title,
				});
			}
		}
	}, [edits, messages, stateUrl, sessionId]);

	// Build the picker once; never pick the panel itself.
	useEffect(() => {
		const picker = new ElementPicker({
			filter: (el) => !el.closest(host),
			onClick: (target) => {
				// Clicks inside our shadow panel retarget to the host at the
				// document-level listener; the library's `filter` only gates the
				// hover highlight, not selection. Ignore them so the "Select
				// element" button (and the panel) never get picked.
				if ((target as Element).closest(host)) return;
				setSelected({
					selector: cssPath(target) || "body",
					html: target.outerHTML.slice(0, 4000),
				});
				picker.stopPicking();
			},
		});
		pickerRef.current = picker;
		picker.startPicking(); // auto-activate on first inject

		const onMsg = (m: any) => {
			if (m?.type === "activate-picker") picker.startPicking();
		};
		browser.runtime.onMessage.addListener(onMsg);
		return () => {
			browser.runtime.onMessage.removeListener(onMsg);
			picker.destroy();
		};
	}, [host]);

	async function send() {
		const prompt = input.trim();
		if (!prompt || busy) return;
		if (!selected) {
			setMessages((m) => [
				...m,
				{
					role: "error",
					text: "Pick an element first (click the extension icon).",
				},
			]);
			return;
		}
		setMessages((m) => [...m, { role: "user", text: prompt }]);
		setInput("");
		setBusy(true);
		// Feed back any CSS already applied to this element so the AI builds on it
		// (blue + monospace) instead of replacing it — its result overwrites the
		// per-selector entry, so it must return the full, merged rule.
		const prior = edits[selected.selector];
		const context =
			`Target selector: ${selected.selector}\n\nElement HTML:\n${selected.html}` +
			(prior
				? `\n\nCSS already applied to this element (modify/extend it, keep existing declarations unless the request changes them):\n${prior}`
				: "");
		const res = await browser.runtime.sendMessage({
			type: "ai-edit",
			prompt,
			context,
			selector: selected.selector,
		});
		setBusy(false);
		if (res?.error || typeof res?.css !== "string") {
			// keep the prompt recoverable: drop it back in the box so a typo is one edit away
			setMessages((m) => [
				...m,
				{ role: "error", text: res?.error ?? "No CSS returned." },
			]);
			setInput(prompt);
			return;
		}
		const merged = mergeRule(selected.selector, prior, res.css);
		setEdits((e) => ({ ...e, [selected.selector]: merged }));
		console.log("[frimmy] applied CSS:", merged); // also in the page console
		setMessages((m) => [
			...m,
			{ role: "assistant", text: merged, css: merged },
		]);
	}

	async function save() {
		const css = Object.values(edits).join("\n\n");
		if (!css) return;
		// Blob carries the whole panel state so a shared link restores chat too.
		// `css` stays at top level for any plain-CSS consumer.
		const diff = JSON.stringify({ css, messages, edits });
		const target_url = location.href;
		const title = document.title;

		// Bound to a session -> update that same id (PUT). Fall back to creating a
		// new record if the update fails (e.g. you're viewing someone else's share,
		// so you don't own it -> 404).
		let id = sessionId;
		if (id) {
			const res = await browser.runtime.sendMessage({
				type: "update-edit",
				id,
				diff,
				target_url,
				title,
			});
			if (res?.error) id = null; // not owned / gone -> create a fresh one below.
		}
		if (!id) {
			const res = await browser.runtime.sendMessage({
				type: "save-edit",
				diff,
				target_url,
				title,
			});
			if (!res?.id) {
				setMessages((m) => [
					...m,
					{ role: "error", text: res?.error ?? "Save failed." },
				]);
				return;
			}
			id = res.id;
			setSessionId(id); // bind so later saves update this same record.
		}
		const link = `${location.origin}?frimmy=${id}`;
		// Copy the share link so users don't have to select it out of the chat.
		try {
			await navigator.clipboard.writeText(link);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch {
			// Clipboard blocked (no focus / permissions) — link is still in the log.
		}
		setMessages((m) => [
			...m,
			{ role: "assistant", text: `Saved. Share: ${link}` },
		]);
	}

	function clear() {
		// Destructive: also deletes the shared DB record. Confirm first.
		// ponytail: native confirm — accessible and zero code; swap for a toast-undo if it annoys.
		if (!confirm("Clear all edits on this page? This can't be undone.")) return;
		// Wipe everything for this URL: in-memory state, the applied CSS, the
		// per-URL working state, and the local auto-banner index.
		setEdits({});
		setMessages([GREETING]);
		browser.runtime.sendMessage({ type: "clear-state", url: stateUrl });
		// Also delete the shared snapshot (D1 + KV blob) this panel is bound to,
		// then drop ?frimmy= from the URL so a reload starts clean instead of
		// re-loading a now-deleted id. Ignore 404s (not owned / already gone).
		if (sessionId) {
			browser.runtime.sendMessage({ type: "delete-edit", id: sessionId });
			setSessionId(null);
		}
		const u = new URL(location.href);
		if (u.searchParams.has("frimmy")) {
			u.searchParams.delete("frimmy");
			history.replaceState(null, "", u.toString());
		}
	}

	// Edits whose selector matches nothing on the current page — the AI's CSS is
	// silently doing nothing (page changed, or a shared edit for a different layout).
	const staleSelectors = Object.keys(edits).filter(
		(sel) => !sel.startsWith("shared:") && !document.querySelector(sel),
	);

	return (
		<div className="frimmy">
			<div className="frimmy-head">
				Frimmy
				<span className="frimmy-target">
					{selected ? selected.selector : "no element"}
				</span>
				<button
					className="frimmy-pick"
					onClick={() => pickerRef.current?.startPicking()}
					title="Pick a new element"
				>
					Select element
				</button>
			</div>
			{staleSelectors.length > 0 && (
				<div className="frimmy-stale">
					⚠ {staleSelectors.length} edit
					{staleSelectors.length > 1 ? "s" : ""} match nothing on this page.
				</div>
			)}
			<div className="frimmy-log" ref={logRef}>
				{messages.map((m, i) => (
					<div
						key={i}
						className={`frimmy-msg ${m.role}`}
						onClick={() => m.role === "user" && setInput(m.text)}
						title={m.role === "user" ? "Click to reuse this prompt" : undefined}
					>
						{m.text}
					</div>
				))}
				{busy && <div className="frimmy-msg assistant">…</div>}
			</div>
			<textarea
				className="frimmy-input"
				value={input}
				placeholder="Describe the edit…"
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						send();
					}
				}}
			/>
			<div className="frimmy-actions">
				<button
					className="frimmy-primary"
					onClick={send}
					disabled={busy || !input.trim() || !selected}
					title={!selected ? "Pick an element first" : undefined}
				>
					Generate
				</button>
				<button
					className="frimmy-secondary"
					onClick={save}
					disabled={busy || !Object.keys(edits).length}
				>
					{saved ? "Copied ✓" : "Save & Share"}
				</button>
				<button
					className="frimmy-ghost"
					onClick={clear}
					disabled={busy || (messages.length <= 1 && !Object.keys(edits).length)}
				>
					Clear
				</button>
			</div>
		</div>
	);
}
