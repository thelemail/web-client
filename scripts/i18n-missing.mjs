import { readFileSync } from 'node:fs';

const dir = new URL('../packages/core/messages/', import.meta.url);
const settings = JSON.parse(
	readFileSync(new URL('../packages/core/project.inlang/settings.json', import.meta.url), 'utf8')
);
const load = (locale) => {
	const { $schema, ...messages } = JSON.parse(readFileSync(new URL(`${locale}.json`, dir), 'utf8'));
	return messages;
};

const texts = (value) =>
	typeof value === 'string' ? [value] : value.flatMap((variant) => Object.values(variant.match));
const unescaped = (text) => text.replace(/\\[{}]/g, '');
const variables = (value) =>
	[...new Set(texts(value).flatMap((t) => [...unescaped(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
const tags = (value) =>
	[...new Set(texts(value).flatMap((t) => [...t.matchAll(/<(\w+)>/g)].map((m) => m[1])))].sort();
const inputs = (value) =>
	typeof value === 'string'
		? variables(value)
		: [
				...new Set(
					value.flatMap((v) =>
						v.declarations.filter((d) => d.startsWith('input ')).map((d) => d.slice(6).trim())
					)
				)
			].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const base = load(settings.baseLocale);
const keys = Object.keys(base);
const verbose = process.argv.includes('--keys');
let problems = 0;

for (const locale of settings.locales) {
	if (locale === settings.baseLocale) continue;
	const messages = load(locale);
	const missing = keys.filter((key) => !(key in messages) || messages[key] === '');
	console.log(`${locale}: ${keys.length - missing.length}/${keys.length} translated`);
	if (verbose) for (const key of missing) console.log(`  ${key}`);
	for (const key of Object.keys(messages)) {
		const issue = !(key in base)
			? `not in ${settings.baseLocale}`
			: !same(inputs(messages[key]), inputs(base[key]))
				? `inputs ${inputs(messages[key])} instead of ${inputs(base[key])}`
				: !same(variables(messages[key]), variables(base[key]))
					? `variables ${variables(messages[key])} instead of ${variables(base[key])}`
					: !same(tags(messages[key]), tags(base[key]))
						? `tags ${tags(messages[key])} instead of ${tags(base[key])}`
						: null;
		if (issue) {
			problems++;
			console.log(`  ${key}: ${issue}`);
		}
	}
}

if (problems > 0) process.exitCode = 1;
