import { sellbaseError, type NotifyAdapter } from '@sellbase/core';

/** Transactional email through Resend's REST API (fetch, no SDK). */
export function resendNotify(options: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): NotifyAdapter {
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const res = await doFetch(`https://api.resend.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; name?: string };
    if (!res.ok) {
      throw sellbaseError(
        res.status === 401 || res.status === 403 ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
        `Resend: ${json.message ?? `HTTP ${res.status}`}`,
        res.status === 403
          ? 'Verify your sending domain in resend.com/domains, or use onboarding@resend.dev while testing.'
          : 'Check the API key and the Resend dashboard logs.',
        { status: res.status, resend_error: json.name },
      );
    }
    return json;
  }

  return {
    id: 'resend',
    channel: 'email',
    async send(message) {
      const sent = await call<{ id: string }>(
        'POST',
        '/emails',
        {
          from: message.from ?? options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.reply_to ? { reply_to: message.reply_to } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((f) => ({
                  filename: f.filename,
                  content: f.content_base64,
                  content_type: f.content_type,
                })),
              }
            : {}),
        },
        message.idempotency_key,
      );
      return { provider_message_id: sent.id };
    },
    async test() {
      const domains = await call<{ data?: { name: string; status: string }[] }>('GET', '/domains');
      const verified = (domains.data ?? [])
        .filter((d) => d.status === 'verified')
        .map((d) => d.name);
      return verified.length
        ? { ok: true, message: `Resend connected. Verified domains: ${verified.join(', ')}.` }
        : {
            ok: true,
            message:
              'Resend connected, but no verified domain yet: emails can only go to your own address. Verify a domain in resend.com/domains.',
          };
    },
  };
}
