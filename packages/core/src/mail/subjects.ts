const RE_PREFIX = /^re:\s/i;
const FWD_PREFIX = /^fwd?:\s/i;
const ANY_PREFIX = /^(re|fwd?):\s*/i;

export function strippedSubject(s: string): string {
	return (s || '').trim().replace(ANY_PREFIX, '').trim();
}

export function replySubject(s: string): string {
	const t = (s || '').trim();
	return RE_PREFIX.test(t) ? t : `Re: ${t || '(no subject)'}`;
}

export function forwardSubject(s: string): string {
	const t = (s || '').trim();
	return FWD_PREFIX.test(t) ? t : `Fwd: ${t || '(no subject)'}`;
}
