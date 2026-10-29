export interface LeaveGuard {
	pending(): boolean;
	settle(): Promise<boolean>;
	focus?(): void;
}

const guards = new Set<LeaveGuard>();

export function holdLeave(guard: LeaveGuard): () => void {
	guards.add(guard);
	return () => {
		guards.delete(guard);
	};
}

export function leavePending(): boolean {
	for (const guard of guards) if (guard.pending()) return true;
	return false;
}

export async function settleForLeave(): Promise<boolean> {
	const list = [...guards].filter((g) => g.pending());
	const results = await Promise.all(
		list.map(async (guard) => {
			try {
				return await guard.settle();
			} catch {
				return false;
			}
		})
	);
	const blocked = list.find((_, i) => !results[i]);
	blocked?.focus?.();
	return !blocked;
}
