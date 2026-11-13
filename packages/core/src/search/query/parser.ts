import {
	fail,
	LIMITS,
	type ParticipantRole,
	type ProximityOperand,
	type QueryNode,
	type QuerySnapshot,
	type Range,
	type TextField
} from './ast';
import { lookupFilter, participantValue, rejectUnknown, scalarValue } from './filters';
import { asciiLower, type Token } from './lexer';
import { codePoints, foldText, laneOf } from './text';

type Scope = { kind: 'field'; field: TextField } | { kind: 'participant'; role: ParticipantRole } | null;

const FILTER_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function span(a: Range, b: Range): Range {
	return { start: a.start, end: b.end };
}

function isStop(token: Token | undefined): boolean {
	return token === undefined || token.type === 'rparen' || token.type === 'rbrace';
}

function isOperator(token: Token | undefined): boolean {
	return token !== undefined && (token.type === 'or' || token.type === 'and' || token.type === 'around');
}

export class Parser {
	#tokens: Token[];
	#input: string;
	#snapshot: QuerySnapshot;
	#pos = 0;
	#depth = 0;

	constructor(tokens: Token[], input: string, snapshot: QuerySnapshot) {
		this.#tokens = tokens;
		this.#input = input;
		this.#snapshot = snapshot;
	}

	parse(): QueryNode | null {
		if (!this.#tokens.length) return null;
		const node = this.#or(null);
		const rest = this.#peek();
		if (rest) fail(isStop(rest) ? 'unbalanced_paren' : 'dangling_operator', rest.range);
		return node;
	}

	#peek(): Token | undefined {
		return this.#tokens[this.#pos];
	}

	#next(): Token | undefined {
		const token = this.#tokens[this.#pos];
		if (token) this.#pos += 1;
		return token;
	}

	#end(): Range {
		return { start: this.#input.length, end: this.#input.length };
	}

	#enter(range: Range): void {
		this.#depth += 1;
		if (this.#depth > LIMITS.depth) fail('too_deep', range);
	}

	#leave(): void {
		this.#depth -= 1;
	}

	#operand(operator: Token): void {
		const next = this.#peek();
		if (isStop(next) || isOperator(next)) fail('dangling_operator', operator.range);
	}

	#or(scope: Scope): QueryNode {
		const first = this.#peek();
		if (first && isOperator(first)) fail('dangling_operator', first.range);
		const children = [this.#and(scope)];
		while (this.#peek()?.type === 'or') {
			const operator = this.#next() as Token;
			this.#operand(operator);
			children.push(this.#and(scope));
		}
		if (children.length === 1) return children[0];
		return { kind: 'or', children, range: span(children[0].range, children[children.length - 1].range) };
	}

	#and(scope: Scope): QueryNode {
		const children = [this.#around(scope)];
		for (;;) {
			const token = this.#peek();
			if (isStop(token) || token?.type === 'or') break;
			if (token?.type === 'and') {
				this.#next();
				this.#operand(token);
				continue;
			}
			if (token?.type === 'around') fail('dangling_operator', token.range);
			children.push(this.#around(scope));
		}
		if (children.length === 1) return children[0];
		return { kind: 'and', children, range: span(children[0].range, children[children.length - 1].range) };
	}

	#around(scope: Scope): QueryNode {
		let left = this.#unary(scope);
		while (this.#peek()?.type === 'around') {
			const keyword = this.#next() as Token;
			const count = this.#next();
			if (!count || count.type !== 'word' || !/^\d{1,7}$/.test(count.raw)) {
				fail('around_distance', count ? span(keyword.range, count.range) : keyword.range);
			}
			const distance = Number(count.raw);
			if (distance > LIMITS.distance) fail('around_distance', count.range);
			if (isStop(this.#peek()) || isOperator(this.#peek())) fail('dangling_operator', keyword.range);
			const right = this.#unary(scope);
			const operand = (node: QueryNode): ProximityOperand => {
				if (node.kind !== 'term' && node.kind !== 'phrase') fail('around_operand', node.range);
				return node;
			};
			left = {
				kind: 'around',
				left: operand(left),
				right: operand(right),
				distance,
				range: span(left.range, right.range)
			};
		}
		return left;
	}

	#unary(scope: Scope): QueryNode {
		const token = this.#peek();
		if (token?.type !== 'minus') return this.#primary(scope);
		this.#next();
		const child = this.#unary(scope);
		return { kind: 'not', child, range: span(token.range, child.range) };
	}

	#primary(scope: Scope): QueryNode {
		const token = this.#next();
		if (!token) fail('dangling_operator', this.#end());
		switch (token.type) {
			case 'lparen':
				return this.#paren(token, scope).node;
			case 'lbrace':
				return this.#brace(token, scope).node;
			case 'rparen':
			case 'rbrace':
				return fail('unbalanced_paren', token.range);
			case 'or':
			case 'and':
			case 'around':
			case 'minus':
				return fail('dangling_operator', token.range);
			case 'plus':
				return this.#literal(token, scope);
			case 'quoted':
				return this.#phrase(token.value, token.range, scope);
			case 'word':
				return this.#word(token, scope);
		}
	}

	#paren(open: Token, scope: Scope): { node: QueryNode; close: Token } {
		this.#enter(open.range);
		const next = this.#peek();
		if (next?.type === 'rparen') fail('empty_group', span(open.range, next.range));
		if (!next) fail('unbalanced_paren', open.range);
		const node = this.#or(scope);
		const close = this.#next();
		if (!close || close.type !== 'rparen') fail('unbalanced_paren', close?.type === 'rbrace' ? close.range : open.range);
		this.#leave();
		return { node, close };
	}

	#brace(open: Token, scope: Scope): { node: QueryNode; close: Token } {
		this.#enter(open.range);
		const children: QueryNode[] = [];
		for (;;) {
			const token = this.#peek();
			if (!token) fail('unbalanced_paren', open.range);
			if (token.type === 'rbrace') break;
			if (token.type === 'rparen') fail('unbalanced_paren', token.range);
			if (token.type === 'or') {
				this.#next();
				if (!children.length) fail('dangling_operator', token.range);
				this.#operand(token);
				continue;
			}
			if (token.type === 'and') fail('dangling_operator', token.range);
			children.push(this.#around(scope));
		}
		const close = this.#next() as Token;
		if (!children.length) fail('empty_group', span(open.range, close.range));
		this.#leave();
		const node: QueryNode =
			children.length === 1
				? children[0]
				: { kind: 'or', children, range: span(children[0].range, children[children.length - 1].range) };
		return { node, close };
	}

	#literal(plus: Token, scope: Scope): QueryNode {
		const token = this.#next();
		if (scope?.kind === 'participant' || !token) fail('literal_operand', plus.range);
		if (token.type === 'quoted') return this.#phrase(token.value, span(plus.range, token.range), scope);
		if (token.type !== 'word' || this.#filterName(token.raw) !== null || token.raw.includes('*')) {
			fail('literal_operand', span(plus.range, token.range));
		}
		const text = foldText(token.raw);
		return { kind: 'literal', text, lane: laneOf(text), range: span(plus.range, token.range) };
	}

	#phrase(value: string, range: Range, scope: Scope): QueryNode {
		if (scope?.kind === 'participant') return participantValue(scope.role, value, true, range);
		const text = foldText(value).replace(/\s+/gu, ' ').trim();
		if (!text) fail('empty_phrase', range);
		return { kind: 'phrase', text, range };
	}

	#filterName(raw: string): string | null {
		const at = raw.indexOf(':');
		if (at <= 0) return null;
		const name = raw.slice(0, at);
		if (!FILTER_NAME.test(name) || raw.startsWith('//', at + 1)) return null;
		return name;
	}

	#word(token: Extract<Token, { type: 'word' }>, scope: Scope): QueryNode {
		const name = this.#filterName(token.raw);
		if (name !== null) return this.#filter(token, name, scope);
		if (scope?.kind === 'participant') return participantValue(scope.role, token.raw, false, token.range);
		return this.#text(token.raw, token.range);
	}

	#text(raw: string, range: Range): QueryNode {
		const star = raw.indexOf('*');
		if (star >= 0) {
			if (star !== raw.length - 1) fail('invalid_wildcard', range);
			const text = foldText(raw.slice(0, -1));
			if (codePoints(text) < 2) fail('prefix_too_short', range);
			return { kind: 'prefix', text, range };
		}
		const text = foldText(raw);
		return { kind: 'term', text, lane: laneOf(text), range };
	}

	#filter(token: Extract<Token, { type: 'word' }>, name: string, scope: Scope): QueryNode {
		const nameRange = { start: token.range.start, end: token.range.start + name.length + 1 };
		if (scope) fail('nested_scope', token.range);
		const def = lookupFilter(name) ?? rejectUnknown(name, nameRange);
		let value = token.raw.slice(name.length + 1);
		let quoted = false;
		let range = token.range;
		if (!value) {
			const next = this.#peek();
			if (!next || next.spaced || !['quoted', 'lparen', 'lbrace'].includes(next.type)) {
				fail('missing_value', token.range, { name: `${asciiLower(name)}:` });
			}
			if (next.type !== 'quoted') {
				if (def.kind !== 'field' && def.kind !== 'participant') fail('invalid_value', next.range, { name: `${asciiLower(name)}:` });
				this.#next();
				const inner: Scope =
					def.kind === 'field' ? { kind: 'field', field: def.field } : { kind: 'participant', role: def.role };
				const group = next.type === 'lparen' ? this.#paren(next, inner) : this.#brace(next, inner);
				const whole = span(token.range, group.close.range);
				return def.kind === 'field' ? { kind: 'field', field: def.field, child: group.node, range: whole } : group.node;
			}
			this.#next();
			value = next.value;
			quoted = true;
			range = span(token.range, next.range);
		}
		switch (def.kind) {
			case 'field': {
				const child = quoted ? this.#phrase(value, range, null) : this.#text(value, range);
				return { kind: 'field', field: def.field, child, range };
			}
			case 'participant':
				return participantValue(def.role, value, quoted, range);
			default:
				return scalarValue(name, def, value, range, this.#snapshot);
		}
	}
}
