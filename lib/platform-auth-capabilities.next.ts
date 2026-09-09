// Vercel/standalone Node does not authenticate Sites or Cloudflare headers.
// This is fixed at build time, never controlled by a request or public env var.
import { nextLocalStorageEnabled } from './next-local-storage-policy.mjs';

export const trustSitesIdentityHeaders = false;
export const sitesSignInEnabled = false;
// Remove this gate only after backend adapters and independent auth are tested.
export const migrationPreviewOnly = !nextLocalStorageEnabled(process.env);
