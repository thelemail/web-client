export type RestartHold = () => Promise<string | null> | string | null;

const holds = new Set<RestartHold>();

export function holdRestart(hold: RestartHold): () => void {
	holds.add(hold);
	return () => {
		holds.delete(hold);
	};
}

export async function restartBlockers(): Promise<string[]> {
	const reasons = await Promise.all(
		[...holds].map(async (hold) => {
			try {
				return await hold();
			} catch {
				return 'Something is still saving.';
			}
		})
	);
	return reasons.filter((reason): reason is string => !!reason);
}
