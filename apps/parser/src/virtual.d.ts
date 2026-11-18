declare module 'virtual:parser-assets' {
	const bundle: { path: string; size: number; sha256: string; entries: { id: string; offset: number; size: number; sha256: string }[] };
	export default bundle;
}
