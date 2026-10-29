export function canTakeFocus(active: Element | null): boolean {
	if (!(active instanceof HTMLElement)) return true;
	if (active.isContentEditable) return false;
	if (active.matches('input, textarea, select')) return false;
	return !active.closest('[role="dialog"], [role="menu"]');
}
