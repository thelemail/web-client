const OWN_KEYS = 'nav, [role="tree"], [role="menu"], [role="dialog"]';

export function isListShortcut(e: KeyboardEvent): boolean {
	if (e.defaultPrevented) return false;
	return !(e.target instanceof Element && e.target.closest(OWN_KEYS));
}
