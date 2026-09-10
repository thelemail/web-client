export function coalesce(fn: () => void, windowMs: number): () => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return () => {
		if (timer !== null) return;
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, windowMs);
	};
}
