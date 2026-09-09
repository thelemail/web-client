export interface ProductTarget {
	audience: string;
	origin: string;
}

function parse(value: string | undefined): ProductTarget[] {
	if (!value) return [];
	const out: ProductTarget[] = [];
	for (const entry of value.split(',')) {
		const [audience, origin] = entry.split('=');
		if (!audience?.trim() || !origin?.trim()) continue;
		try {
			out.push({ audience: audience.trim(), origin: new URL(origin.trim()).origin });
		} catch {
			continue;
		}
	}
	return out;
}

const targets = parse(import.meta.env.PUBLIC_PRODUCT_ORIGINS);

export const currentProduct = import.meta.env.PUBLIC_THELEMAIL_PRODUCT || 'app';

export const isProductVault = currentProduct !== 'app';

export function productTarget(audience: string): ProductTarget | null {
	return targets.find((t) => t.audience === audience) ?? null;
}

export function productOrigins(): ProductTarget[] {
	return [...targets];
}

export function appOrigin(): string {
	return productTarget('app')?.origin ?? '/';
}
