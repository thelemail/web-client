import { Field } from '../sqlite/types';

export interface Region {
	field: Field;
	text: string;
}

const QUOTE = /^\s*>/;
const ATTRIBUTION = /(?:wrote|schrieb|a écrit|escreveu|escribió|написал[аи]?)\s*:\s*$/i;
const ORIGINAL = /^\s*-{2,}\s*(?:original message|ursprüngliche nachricht|message d'origine|mensagem original|mensaje original)\s*-{2,}\s*$/i;
const SIGNATURE = /^-- ?$/;

export function regions(text: string): Region[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const fields: Field[] = new Array(lines.length).fill(Field.body);
	let mode: Field = Field.body;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (mode !== Field.quoted && ORIGINAL.test(line)) mode = Field.quoted;
		if (mode === Field.quoted) {
			fields[i] = Field.quoted;
			continue;
		}
		if (QUOTE.test(line)) {
			fields[i] = Field.quoted;
			let j = i - 1;
			while (j >= 0 && lines[j].trim() === '' && fields[j] !== Field.quoted) j--;
			if (j >= 0 && fields[j] !== Field.quoted && ATTRIBUTION.test(lines[j])) {
				for (let k = j; k < i; k++) fields[k] = Field.quoted;
			}
			continue;
		}
		if (SIGNATURE.test(line)) mode = Field.signature;
		fields[i] = mode === Field.signature ? Field.signature : Field.body;
	}
	const out: Region[] = [];
	for (let i = 0; i < lines.length; i++) {
		const last = out[out.length - 1];
		if (last && last.field === fields[i]) last.text += `\n${lines[i]}`;
		else out.push({ field: fields[i], text: lines[i] });
	}
	return out.map((r) => ({ field: r.field, text: r.text.trim() })).filter((r) => r.text.length > 0);
}
