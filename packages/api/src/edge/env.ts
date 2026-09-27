import type { NotifyAdapter, PaymentsAdapter, ShippingAdapter } from '@sellbase/core';
import { createClient } from '@supabase/supabase-js';
import { createSql } from '../db.js';
import type { Deps } from '../deps.js';

declare const Deno: { env: { get(name: string): string | undefined } };

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/**
 * Builds production dependencies inside a Supabase Edge Function. Adapter factories are
 * provided by the caller so this file stays free of provider SDKs.
 */
export function edgeDeps(adapters: {
  payments: (secrets: Record<string, string>) => PaymentsAdapter;
  shipping: (config: Record<string, unknown>) => ShippingAdapter;
  notify: (secrets: Record<string, string> | null, from: string) => NotifyAdapter;
}): Deps {
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  // Local stack only: the default DB host (supabase_db_<project>) has underscores, which
  // Deno's resolver rejects. config.toml points SELLBASE_DB_HOST at a valid alias.
  const host = Deno.env.get('SELLBASE_DB_HOST');
  const sql = createSql(env('SUPABASE_DB_URL'), { max: 3, ...(host ? { host } : {}) });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const publicUrl = Deno.env.get('SELLBASE_PUBLIC_URL') ?? url;
  let storeId: string | null = null;

  const secrets: Deps['secrets'] = async (id, provider) => {
    const [row] = await sql<
      { secret: string | null }[]
    >`select sellbase.get_integration_secret(${id}, ${provider}) as secret`;
    return row?.secret ? (JSON.parse(row.secret) as Record<string, string>) : null;
  };

  return {
    sql,
    storeId: async () => {
      if (storeId) return storeId;
      const [row] = await sql<{ id: string }[]>`select sellbase.current_store_id() as id`;
      if (!row?.id) throw new Error('No store found. Run `sellbase init`.');
      storeId = row.id;
      return storeId;
    },
    verifyUserJwt: async (jwt) => {
      const { data, error } = await supabase.auth.getUser(jwt);
      return error ? null : (data.user?.id ?? null);
    },
    secrets,
    payments: async (id) => {
      const s = await secrets(id, 'stripe');
      return s?.secret_key ? adapters.payments(s) : null;
    },
    shipping: async (id) => {
      const [row] = await sql<{ settings: { shipping?: Record<string, unknown> } }[]>`
        select settings from sellbase.stores where id = ${id}`;
      return adapters.shipping(row?.settings.shipping ?? {});
    },
    notify: async (id) => {
      const [row] = await sql<{ name: string; contact_email: string | null }[]>`
        select name, contact_email::text from sellbase.stores where id = ${id}`;
      const from =
        Deno.env.get('SELLBASE_EMAIL_FROM') ??
        `${row?.name ?? 'Store'} <${row?.contact_email ?? 'orders@example.com'}>`;
      return adapters.notify(await secrets(id, 'resend'), from);
    },
    storage: {
      signedUrl: async (bucket, path, expiresIn) => {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, expiresIn);
        if (error || !data) throw new Error(`Could not sign ${bucket}/${path}: ${error?.message}`);
        // Locally SUPABASE_URL is the internal Docker address; buyers need the public one.
        return data.signedUrl.replace(url, publicUrl);
      },
      upload: async (bucket, path, bytes, contentType) => {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, bytes, { contentType, upsert: true });
        if (error) throw new Error(`Could not upload ${bucket}/${path}: ${error.message}`);
      },
      publicUrl: (bucket, path) => `${publicUrl}/storage/v1/object/public/${bucket}/${path}`,
    },
    now: () => new Date(),
    publicApiUrl: `${publicUrl}/functions/v1/sellbase-api`,
    version: '0.1.0',
  };
}
