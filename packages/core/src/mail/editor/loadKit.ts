export type EditorKit = typeof import('./kit');

let loaded: EditorKit | null = null;
let loading: Promise<EditorKit> | null = null;

export function loadedEditorKit(): EditorKit | null {
	return loaded;
}

export function loadEditorKit(): Promise<EditorKit> {
	loading ??= import('./kit').then(
		(kit) => (loaded = kit),
		(error) => {
			loading = null;
			throw error;
		}
	);
	return loading;
}
