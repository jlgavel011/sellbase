import { logNotify, manualShipping, resendNotify, stripePayments } from '@sellbase/adapters';
import { edgeDeps } from './env.js';

export const deps = () =>
  edgeDeps({
    payments: (secrets) => stripePayments({ secretKey: secrets.secret_key ?? '' }),
    shipping: (config) => manualShipping(config),
    // Without Resend, emails are printed to the function logs so local tests still work.
    notify: (secrets, from) =>
      secrets?.secret_key ? resendNotify({ apiKey: secrets.secret_key, from }) : logNotify(),
  });
