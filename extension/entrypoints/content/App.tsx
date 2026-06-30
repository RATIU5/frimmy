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

export default function App({ host }: { host: string }) {
	const [messages, setMessages] = useState<Msg[]>([]);
	const [input, setInput] = useState("");
	const [selected, setSelected] = useState<{
		selector: string;
		html: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const pickerRef = useRef<ElementPicker | null>(null);

	// Build the picker once; never pick the panel itself.
	useEffect(() => {
		const picker = new ElementPicker({
			filter: (el) => !el.closest(host),
			onClick: (target) => {
				setSelected({
					selector: cssPath(target),
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
		const context = `Target selector: ${selected.selector}\n\nElement HTML:\n${selected.html}`;
		const res = await browser.runtime.sendMessage({
			type: "ai-edit",
			prompt,
			context,
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
		applyCss(res.css);
		setMessages((m) => [
			...m,
			{ role: "assistant", text: "Applied.", css: res.css },
		]);
	}

	async function save() {
		const css = [...messages].reverse().find((m) => m.css)?.css;
		if (!css) return;
		const res = await browser.runtime.sendMessage({
			type: "save-edit",
			diff: css,
			target_url: location.href,
			title: document.title,
		});
		setMessages((m) => [
			...m,
			res?.id
				? {
						role: "assistant",
						text: `Saved. Share: ${location.origin}?frimmy=${res.id}`,
					}
				: { role: "error", text: res?.error ?? "Save failed." },
		]);
	}

	return (
		<div className="frimmy">
			<div className="frimmy-head">
				Frimmy
				<span className="frimmy-target">
					{selected ? selected.selector : "no element"}
				</span>
			</div>
			<div className="frimmy-log">
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
				<button onClick={send} disabled={busy}>
					Generate
				</button>
				<button onClick={save} disabled={busy}>
					Save & Share
				</button>
			</div>
		</div>
	);
}
