import { standaloneWorkerBundle } from './standalone-worker-bundle.mjs';

// Build in memory for isolated verification; never invokes deployment.
export async function fileTransferWorkerBundle() {
  return standaloneWorkerBundle('files');
}
