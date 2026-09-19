import { readFileSync } from 'node:fs';

const dir = new URL('../packages/core/messages/', import.meta.url);
const settings = JSON.parse(
	readFileSync(new URL('../packages/core/project.inlang/settings.json', import.meta.url), 'utf8')
);
const load = (locale) => {
	const { $schema, ...messages } = JSON.parse(readFileSync(new URL(`${locale}.json`, dir), 'utf8'));
	return messages;
};

const base = load(settings.baseLocale);
const keys = Object.keys(base);
const verbose = process.argv.includes('--keys');
let stale = 0;

for (const locale of settings.locales) {
	if (locale === settings.baseLocale) continue;
	const messages = load(locale);
	const missing = keys.filter((key) => !(key in messages) || messages[key] === '');
	const extra = Object.keys(messages).filter((key) => !(key in base));
	stale += extra.length;
	console.log(`${locale}: ${keys.length - missing.length}/${keys.length} translated`);
	if (verbose) for (const key of missing) console.log(`  ${key}`);
	for (const key of extra) console.log(`  not in ${settings.baseLocale}: ${key}`);
}

if (stale > 0) process.exitCode = 1;
