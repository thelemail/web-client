export type ProductKeysErrorCode =
	| 'malformed'
	| 'too-large'
	| 'context'
	| 'decrypt'
	| 'forbidden'
	| 'signature'
	| 'profile'
	| 'transition';

export class ProductKeysError extends Error {
	readonly code: ProductKeysErrorCode;

	constructor(code: ProductKeysErrorCode, detail?: string) {
		super(detail ? `productkeys: ${code}: ${detail}` : `productkeys: ${code}`);
		this.name = 'ProductKeysError';
		this.code = code;
	}
}

export function fail(code: ProductKeysErrorCode, detail?: string): never {
	throw new ProductKeysError(code, detail);
}
