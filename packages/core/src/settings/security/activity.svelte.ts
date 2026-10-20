class SecurityActivity {
	version = $state(0);

	touch(): void {
		this.version++;
	}
}

export const securityActivity = new SecurityActivity();
