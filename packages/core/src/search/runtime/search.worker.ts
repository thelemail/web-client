/// <reference lib="webworker" />
import { maintenanceJob, serve } from './host';

serve(self as unknown as DedicatedWorkerGlobalScope, [maintenanceJob]);
