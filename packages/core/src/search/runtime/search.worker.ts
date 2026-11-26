/// <reference lib="webworker" />
import { hydrateJob, uploadJob } from '../artifacts/jobs';
import { vectorHydrateJob, vectorUploadJob } from '../artifacts/semantic';
import { embeddingsJob } from '../model/job';
import { attachmentJob, bodyJob, describeJob, sourceSyncJob } from '../sync/jobs';
import { maintenanceJob, serve } from './host';

serve(self as unknown as DedicatedWorkerGlobalScope, [
	sourceSyncJob,
	describeJob,
	hydrateJob,
	bodyJob,
	attachmentJob,
	vectorHydrateJob,
	embeddingsJob,
	uploadJob,
	vectorUploadJob,
	maintenanceJob
]);
