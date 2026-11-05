import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const app = process.cwd();

const forbiddenModules = [
	/packages\/core\/src\/mail\/(?!initials\.ts$|ConfirmDialog\.svelte$|confirm-dialog\.css$)/,
	/packages\/core\/src\/calendar\//,
	/packages\/core\/src\/search\//,
	/packages\/core\/src\/realtime\/(?!device\.ts$)/,
	/packages\/core\/src\/stores\/(auth|mailbox|drafts|scheduled|compose|contacts|signatures|calendarKeys|aliasKeys)\.svelte\.ts$/,
	/packages\/core\/src\/keystore\/keystore-worker\.ts$/,
	/packages\/core\/src\/keystore\/worker\/(content-ops|key-ops|fork-ops|srp-ops)\.ts$/,
	/node_modules\/.*\/(postal-mime|dompurify|@tiptap|ical\.js|marked|turndown|pdfjs-dist)\//
];

const forbiddenStrings = ['postal-mime', 'DOMPurify', 'tiptap', 'ical.js', 'pdfjs', 'thelemail-search-index'];

const modules = readFileSync(join(app, 'build-meta', 'modules.txt'), 'utf8').split('\n').filter(Boolean);
const moduleHits = [...new Set(modules)].filter((id) => forbiddenModules.some((re) => re.test(id)));

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

const stringHits = [];
for (const file of files(join(app, 'build'))) {
	if (!/\.(js|html|css)$/.test(file)) continue;
	const text = readFileSync(file, 'utf8');
	for (const marker of forbiddenStrings) {
		if (text.includes(marker)) stringHits.push(`${file.slice(app.length + 1)}: ${marker}`);
	}
}

if (moduleHits.length || stringHits.length) {
	for (const id of moduleHits) console.error(`check-auth-bundle: forbidden module ${id}`);
	for (const hit of stringHits) console.error(`check-auth-bundle: forbidden marker in ${hit}`);
	process.exit(1);
}
console.log(`check-auth-bundle: ${modules.length} modules, no mail or calendar code`);
