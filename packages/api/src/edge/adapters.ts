import { logNotify, manualShipping } from '@sellbase/adapters';
import type { PaymentsAdapter } from '@sellbase/core';
import { edgeDeps } from './env.js';

// TODO(1d): Stripe payments and Resend email adapters replace these placeholders.
const paymentsPending = (): PaymentsAdapter => {
  throw new Error('The Stripe adapter is not bundled yet.');
};

export const deps = () =>
  edgeDeps({
    payments: paymentsPending,
    shipping: (config) => manualShipping(config),
    notify: () => logNotify(),
  });
