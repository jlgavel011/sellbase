import type { NotifyAdapter, NotifyMessage } from '@sellbase/core';

/** Development notifier: prints emails instead of sending them. Used when Resend is not connected. */
export function logNotify(
  sink: (message: NotifyMessage) => void = (m) =>
    console.log(`[sellbase:email] to=${m.to} subject="${m.subject}"\n${m.text}`),
): NotifyAdapter {
  return {
    id: 'log',
    channel: 'email',
    async send(message) {
      sink(message);
      return { provider_message_id: `log_${message.idempotency_key}` };
    },
    async test() {
      return {
        ok: true,
        message: 'Emails are printed to the function logs (no provider connected).',
      };
    },
  };
}
