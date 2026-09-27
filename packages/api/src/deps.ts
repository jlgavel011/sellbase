import type { NotifyAdapter, PaymentsAdapter, ShippingAdapter } from '@sellbase/core';
import type { Sql } from 'postgres';

/** Everything the apps need from the outside world, injected so tests can swap it. */
export interface Deps {
  sql: Sql;
  /** Store served by this install. v1 has one store; tests pin one per app. */
  storeId: () => Promise<string>;
  /** Verifies a Supabase Auth JWT and returns the user id, or null. */
  verifyUserJwt: (jwt: string) => Promise<string | null>;
  /** Decrypted provider credentials from Vault, or null when not connected. */
  secrets: (storeId: string, provider: string) => Promise<Record<string, string> | null>;
  /** Payment adapter for the store; null when no provider is connected. */
  payments: (storeId: string) => Promise<PaymentsAdapter | null>;
  shipping: (storeId: string) => Promise<ShippingAdapter>;
  notify: (storeId: string) => Promise<NotifyAdapter>;
  storage: {
    signedUrl: (bucket: string, path: string, expiresInSeconds: number) => Promise<string>;
    upload: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
    publicUrl: (bucket: string, path: string) => string;
  };
  /**
   * Sends a Supabase Auth invitation and returns the new user's id. Only called for
   * emails that have no auth user yet.
   */
  inviteUser: (email: string, redirectTo?: string) => Promise<string>;
  /** HTTP client for outbound webhooks; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Resolves a host name to its addresses (webhook SSRF guard); defaults to DNS. */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Local development only: let webhooks reach private addresses (host.docker.internal). */
  allowPrivateWebhooks?: boolean;
  /** Keeps work alive after the response (EdgeRuntime.waitUntil). Absent in tests. */
  background?: (task: Promise<unknown>) => void;
  now: () => Date;
  /** Public base URL of the API function, used in links sent to customers. */
  publicApiUrl: string;
  version: string;
}
