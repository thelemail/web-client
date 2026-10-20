import { describe, expect, it } from 'vitest';
import { userIdEmail, userIdsMatch } from './userId';

describe('user id matching', () => {
	it('reads the email from bracketed and bare user ids', () => {
		expect(userIdEmail('Ada <Ada@Example.org>')).toBe('ada@example.org');
		expect(userIdEmail('ada@example.org')).toBe('ada@example.org');
		expect(userIdEmail('Ada Lovelace')).toBeNull();
	});

	it('matches the entered address case-insensitively', () => {
		expect(userIdsMatch(['Ada <ada@example.org>'], ' ADA@example.org ')).toBe(true);
		expect(userIdsMatch(['Ada <ada@example.org>'], 'eve@example.org')).toBe(false);
		expect(userIdsMatch([], 'ada@example.org')).toBe(false);
	});
});
