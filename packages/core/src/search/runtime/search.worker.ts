/// <reference lib="webworker" />
import { hydrateJob, uploadJob } from '../artifacts/jobs';
import { attachmentJob, bodyJob, describeJob, sourceSyncJob } from '../sync/jobs';
import { maintenanceJob, serve } from './host';

serve(self as unknown as DedicatedWorkerGlobalScope, [sourceSyncJob, describeJob, hydrateJob, bodyJob, attachmentJob, uploadJob, maintenanceJob]);
