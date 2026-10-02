const KEY = 'thelemail:signup-session';
const PATTERN = /^[0-9a-f]{32}$/;

let current: string | null = null;

function generate(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function stored(): string | null {
	try {
		const value = sessionStorage.getItem(KEY);
		return value && PATTERN.test(value) ? value : null;
	} catch {
		return null;
	}
}

function store(value: string | null): void {
	try {
		if (value) sessionStorage.setItem(KEY, value);
		else sessionStorage.removeItem(KEY);
	} catch {
		return;
	}
}

export function signupSession(): string {
	current ??= stored() ?? generate();
	store(current);
	return current;
}

export function endSignupSession(): void {
	current = null;
	store(null);
}
