interface ImportMetaEnv {
	readonly PUBLIC_API_BASE_URL?: string;
	readonly PUBLIC_BLOB_ORIGIN?: string;
	readonly PUBLIC_THELEMAIL_PRODUCT?: string;
	readonly PUBLIC_PRODUCT_ORIGINS?: string;
	readonly PUBLIC_LAUNCHED_PRODUCTS?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare global {
	namespace App {
	}
}

export {};
