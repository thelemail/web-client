class BootStore {
	storageUnavailable = $state(false);

	markStorageUnavailable(): void {
		this.storageUnavailable = true;
	}
}

export const boot = new BootStore();
