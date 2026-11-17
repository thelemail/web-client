/// <reference lib="webworker" />
import { attachmentJob, bodyJob, describeJob, sourceSyncJob } from '../sync/jobs';
import { maintenanceJob, serve } from './host';

serve(self as unknown as DedicatedWorkerGlobalScope, [sourceSyncJob, describeJob, bodyJob, attachmentJob, maintenanceJob]);
