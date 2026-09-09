// Use the pinned Next type; the legacy vinext ambient module shadows 'next'.
import type { NextConfig } from 'next/dist/server/config-shared';
import { nextLocalStorageEnabled } from './lib/next-local-storage-policy.mjs';
import { nextRemoteBackendSelected } from './lib/next-backend-policy.mjs';
import { vercelStorageSelected } from './lib/vercel-storage-policy.mjs';
import { supabaseBackendSelected } from './lib/supabase-backend-policy.mjs';

const localStorage = nextLocalStorageEnabled(process.env);
const remoteBackend = nextRemoteBackendSelected(process.env);
const vercelStorage = vercelStorageSelected(process.env);
const supabaseBackend = supabaseBackendSelected(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  // Preserve the incoming origin for strict mutation/CSRF checks. Next's
  // default NextURL normalization changes loopback 127.0.0.1 to localhost.
  skipProxyUrlNormalize: true,
  serverExternalPackages: localStorage ? ['wrangler'] : [],
  typescript: { tsconfigPath: 'tsconfig.next.json' },
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      '@/lib/platform-runtime': vercelStorage
        ? './lib/platform-runtime.vercel.ts'
        : remoteBackend
          ? './lib/platform-runtime.remote.ts'
          : supabaseBackend
            ? './lib/platform-runtime.supabase.ts'
            : './lib/platform-runtime.next.ts',
      '@/lib/platform-server-gate': vercelStorage
        ? './lib/platform-server-gate.vercel.ts'
        : remoteBackend
          ? './lib/platform-server-gate.remote.ts'
          : supabaseBackend
            ? './lib/platform-server-gate.supabase.ts'
            : './lib/platform-server-gate.ts',
      '@/lib/platform-client-address':
        remoteBackend || vercelStorage || supabaseBackend
          ? './lib/platform-client-address.remote.ts'
          : './lib/platform-client-address.ts',
      '@/lib/platform-file-transfer-capabilities':
        remoteBackend ||
        vercelStorage ||
        supabaseBackend ||
        (localStorage && process.env.PARTNER_HUB_LOCAL_FILE_HTTP === '1')
          ? './lib/platform-file-transfer-capabilities.next.ts'
          : './lib/platform-file-transfer-capabilities.ts',
      '@/lib/platform-file-transfer': remoteBackend
        ? './lib/platform-file-transfer.remote.ts'
        : localStorage
          ? './lib/platform-file-transfer.next.ts'
          : './lib/platform-file-transfer.ts',
      '@/lib/platform-admin-auth':
        remoteBackend || vercelStorage
          ? './lib/platform-admin-auth.remote.ts'
          : supabaseBackend
            ? './lib/platform-admin-auth.supabase.ts'
            : localStorage
              ? './lib/platform-admin-auth.next.ts'
              : './lib/platform-admin-auth.ts',
      '@/lib/next-local-bindings': localStorage
        ? './dev/next-local/bindings.ts'
        : './lib/next-local-bindings.ts',
      '@/lib/platform-auth-capabilities':
        remoteBackend || vercelStorage
          ? './lib/platform-auth-capabilities.remote.ts'
          : supabaseBackend
            ? './lib/platform-auth-capabilities.supabase.ts'
            : './lib/platform-auth-capabilities.next.ts',
      '@/lib/platform-blob-transfer': vercelStorage
        ? './lib/platform-blob-transfer.vercel.ts'
        : supabaseBackend
          ? './lib/platform-blob-transfer.supabase.ts'
          : './lib/platform-blob-transfer.ts',
      '@/lib/file-transfer-client': vercelStorage
        ? './lib/file-transfer-client.vercel.ts'
        : supabaseBackend
          ? './lib/file-transfer-client.supabase.ts'
          : './lib/file-transfer-client.ts',
    },
  },
};

export default nextConfig;
