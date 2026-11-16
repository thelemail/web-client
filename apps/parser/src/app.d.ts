interface ImportMetaEnv {
	readonly PUBLIC_PRODUCT_ORIGINS?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare global {
	namespace App {}
}

export {};
