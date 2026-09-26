export interface UidPlan {
	emails: string[];
	unchanged: boolean;
}

export function planUids(wanted: readonly string[], current: readonly string[]): UidPlan {
	const emails = Array.from(new Set(wanted.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0)));
	const desired = emails.map((e) => `<${e}>`);
	const have = Array.from(new Set(current.map((u) => u.trim().toLowerCase()).filter((u) => u.length > 0)));
	const sameSet = have.length === desired.length && desired.every((u) => have.includes(u));
	return { emails, unchanged: sameSet && have[0] === desired[0] };
}
