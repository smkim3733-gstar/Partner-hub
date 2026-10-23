// Pure synthetic preview: no env files, production access, backup or mail send.
import { buildBackupAlert } from './supabase-backup-alert.mjs';

console.log(
  JSON.stringify(
    {
      mode: 'synthetic-preview',
      transportConfigured: false,
      sent: false,
      receiptVerified: false,
      alert: buildBackupAlert(
        {
          health: 'last-run-failed',
          checkedAt: new Date().toISOString(),
          lastAttempt: { startedAt: '2026-10-21T00:00:00.000Z' },
          lastSuccess: null,
        },
        { synthetic: true },
      ),
    },
    null,
    2,
  ),
);
