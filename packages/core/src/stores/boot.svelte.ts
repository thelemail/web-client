class BootStore {
	storageUnavailable = $state(false);

	markStorageUnavailable(): void {
		this.storageUnavailable = true;
	}

	markStorageAvailable(): void {
		this.storageUnavailable = false;
	}
}

export const boot = new BootStore();
