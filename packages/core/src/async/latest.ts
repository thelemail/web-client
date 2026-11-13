export class Latest {
	#token = 0;

	begin(): number {
		this.#token += 1;
		return this.#token;
	}

	isCurrent(token: number): boolean {
		return token === this.#token;
	}

	invalidate(): void {
		this.#token += 1;
	}
}
