interface ImportMetaEnv {
	readonly PUBLIC_PRODUCT_ORIGINS?: string;
	readonly PUBLIC_PARSER_ORIGIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare global {
	namespace App {}
}

export {};
