import { QuerySyntaxError, type ParseResult, type QuerySnapshot } from './ast';
import { eligibilityOf } from './classify';
import { validTimeZone } from './dates';
import { tokenize } from './lexer';
import { checkLimits } from './limits';
import { Parser } from './parser';
import { universeOf } from './universe';

export function parseQuery(input: string, snapshot: QuerySnapshot): ParseResult {
	const frozen: QuerySnapshot = { now: snapshot.now, timeZone: validTimeZone(snapshot.timeZone) };
	try {
		const root = new Parser(tokenize(input), input, frozen).parse();
		if (root) checkLimits(root);
		return {
			ok: true,
			query: {
				root,
				universe: universeOf(root),
				eligibility: eligibilityOf(root),
				snapshot: frozen
			}
		};
	} catch (err) {
		if (err instanceof QuerySyntaxError) return { ok: false, error: err.error };
		throw err;
	}
}
