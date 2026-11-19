import type { Action } from 'svelte/action';

export type KeyboardShortcutTarget = 'node' | 'window' | 'document';

export type KeyCombo = {
	key: string;
	shift?: boolean;
	ctrl?: boolean;
	meta?: boolean;
	alt?: boolean;
};

export type KeyboardShortcutBinding = {
	id: string;
	combo: KeyCombo | KeyCombo[];
	handler: (event: KeyboardEvent) => void;
	when?: (event: KeyboardEvent) => boolean;
	preventDefault?: boolean;
	ignoreRepeat?: boolean;
	allowEditableTarget?: boolean;
};

export type KeyboardShortcutOptions = {
	target?: KeyboardShortcutTarget;
	bindings: KeyboardShortcutBinding[];
	suppress?: (target: EventTarget | null, event: KeyboardEvent) => boolean;
};

export const isEditableShortcutTarget = (target: EventTarget | null): boolean =>
	target instanceof Element &&
	Boolean(
		target.closest(
			'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [data-slot="dialog-content"], [data-slot="dropdown-menu-content"]'
		)
	);

const normalizeKey = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

const comboMatches = (event: KeyboardEvent, combo: KeyCombo): boolean =>
	normalizeKey(event.key) === normalizeKey(combo.key) &&
	(combo.shift === undefined || event.shiftKey === combo.shift) &&
	(combo.ctrl === undefined || event.ctrlKey === combo.ctrl) &&
	(combo.meta === undefined || event.metaKey === combo.meta) &&
	(combo.alt === undefined || event.altKey === combo.alt);

const bindingMatches = (event: KeyboardEvent, binding: KeyboardShortcutBinding): boolean => {
	if (event.defaultPrevented) return false;
	if (binding.ignoreRepeat !== false && event.repeat) return false;
	const combos = Array.isArray(binding.combo) ? binding.combo : [binding.combo];
	return combos.some((combo) => comboMatches(event, combo));
};

const eventTarget = (
	node: HTMLElement,
	target: KeyboardShortcutTarget
): HTMLElement | Window | Document => {
	if (target === 'window') return window;
	if (target === 'document') return document;
	return node;
};

export const keyboardShortcut: Action<HTMLElement, KeyboardShortcutOptions> = (node, options) => {
	let currentOptions = options;
	let currentTarget = eventTarget(node, currentOptions.target ?? 'node');

	const handleKeydown = (event: Event) => {
		if (!(event instanceof KeyboardEvent)) return;
		const suppress = currentOptions.suppress ?? isEditableShortcutTarget;
		for (const binding of currentOptions.bindings) {
			if (!bindingMatches(event, binding)) continue;
			if (!binding.allowEditableTarget && suppress(event.target, event)) continue;
			if (binding.when && !binding.when(event)) continue;
			if (binding.preventDefault !== false) event.preventDefault();
			binding.handler(event);
			return;
		}
	};

	const attach = () => currentTarget.addEventListener('keydown', handleKeydown);
	const detach = () => currentTarget.removeEventListener('keydown', handleKeydown);

	attach();

	return {
		update(nextOptions: KeyboardShortcutOptions) {
			const nextTarget = eventTarget(node, nextOptions.target ?? 'node');
			if (nextTarget !== currentTarget) {
				detach();
				currentTarget = nextTarget;
				currentOptions = nextOptions;
				attach();
				return;
			}
			currentOptions = nextOptions;
		},
		destroy() {
			detach();
		}
	};
};
