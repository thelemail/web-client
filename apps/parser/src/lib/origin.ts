function appOrigin(raw: string | undefined): string {
	for (const entry of (raw ?? '').split(',')) {
		const [audience, url] = entry.split('=').map((part) => part.trim());
		if (audience === 'app' && url) return new URL(url).origin;
	}
	return '';
}

export const parentOrigin = appOrigin(import.meta.env.PUBLIC_PRODUCT_ORIGINS);
