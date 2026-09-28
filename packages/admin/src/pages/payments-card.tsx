import { formatMoney } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { useRouter } from '../router.js';
import { Alert, Badge, Button, Card, ErrorAlert, Field, Input } from '../ui.js';

interface StripeConfig {
  mode?: 'test' | 'live';
  account?: {
    id: string;
    name: string | null;
    country: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
  };
  webhook?: { setup: 'auto' | 'manual'; endpoint_id?: string; url: string };
  last_webhook_at?: string;
  live_check?: {
    status: 'pending' | 'paid' | 'refunded' | 'refund_failed';
    amount: number;
    currency: string;
    error?: string;
  };
}

const isLiveKey = (key: string) => /^(sk|rk)_live_/.test(key.trim());

/** Settings → Payments: test or live Stripe, account status, webhook and the live check. */
export function PaymentsCard() {
  const { sellbase, t, config: adminConfig } = useAdmin();
  const { absolute } = useRouter();
  const p = t.settings.pay;
  const qc = useQueryClient();
  const locale = adminConfig.locale === 'en' ? 'en-US' : 'es-MX';
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [confirmingLive, setConfirmingLive] = useState(false);
  const [confirmingCheck, setConfirmingCheck] = useState(false);
  const integrations = useQuery({
    queryKey: ['sellbase-admin', 'integrations'],
    queryFn: () => sellbase.admin.integrations.list(),
    // While a live check waits for its payment, watch for the webhook.
    refetchInterval: (q) =>
      (q.state.data?.data.find((i) => i.provider === 'stripe')?.config as StripeConfig | undefined)
        ?.live_check?.status === 'pending'
        ? 5000
        : false,
  });
  const stripe = integrations.data?.data.find((i) => i.provider === 'stripe');
  const cfg = (stripe?.config ?? {}) as StripeConfig;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'integrations'] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'doctor'] });
  };
  const connect = useMutation({
    mutationFn: (confirm: boolean) =>
      sellbase.admin.integrations.connect('stripe', {
        secret_key: secretKey.trim(),
        ...(webhookSecret ? { webhook_secret: webhookSecret.trim() } : {}),
        ...(confirm ? { confirm: true } : {}),
      }),
    onSuccess: () => {
      setSecretKey('');
      setWebhookSecret('');
      setConfirmingLive(false);
      refresh();
    },
  });
  const test = useMutation({
    mutationFn: () => sellbase.admin.integrations.test('stripe'),
    onSuccess: refresh,
  });
  const liveCheck = useMutation({
    mutationFn: () =>
      sellbase.admin.integrations.liveCheck({
        confirm: true,
        success_url: absolute('/settings'),
      }),
    onSuccess: () => {
      setConfirmingCheck(false);
      refresh();
    },
  });
  const submit = () => {
    if (isLiveKey(secretKey) && !confirmingLive) setConfirmingLive(true);
    else connect.mutate(isLiveKey(secretKey));
  };
  const check = cfg.live_check;

  return (
    <Card
      title={t.settings.payments}
      actions={
        stripe?.status !== 'connected' ? (
          <Badge tone="amber">{t.settings.stripeNotConnected}</Badge>
        ) : cfg.mode === 'live' ? (
          <Badge tone="green">{p.live}</Badge>
        ) : (
          <Badge tone="amber">{p.test}</Badge>
        )
      }
    >
      <div className="sb:flex sb:flex-col sb:gap-4" data-testid="payments-card">
        {stripe?.last_error && <Alert>{stripe.last_error}</Alert>}
        {stripe?.status === 'connected' && (
          <dl className="sb:grid sb:gap-3 sb:text-sm sb:md:grid-cols-3">
            <div>
              <dt className="sb:text-zinc-500">{p.account}</dt>
              <dd>
                {cfg.account?.name ?? cfg.account?.id ?? '—'}
                {cfg.account && ` (${cfg.account.country})`}
              </dd>
            </div>
            <div>
              <dt className="sb:text-zinc-500">{p.charges}</dt>
              {cfg.mode !== 'live' ? (
                <dd>{p.testOnly}</dd>
              ) : (
                <dd className="sb:flex sb:flex-wrap sb:gap-1">
                  <Badge tone={cfg.account?.charges_enabled ? 'green' : 'red'}>
                    {cfg.account?.charges_enabled ? p.chargesOn : p.chargesOff}
                  </Badge>
                  <Badge tone={cfg.account?.payouts_enabled ? 'green' : 'amber'}>
                    {cfg.account?.payouts_enabled ? p.payoutsOn : p.payoutsOff}
                  </Badge>
                </dd>
              )}
            </div>
            <div>
              <dt className="sb:text-zinc-500">{p.webhook}</dt>
              <dd>
                {cfg.webhook?.setup === 'auto' ? p.webhookAuto : p.webhookManual}
                <span className="sb:block sb:text-xs sb:text-zinc-500">
                  {cfg.last_webhook_at
                    ? p.lastEvent(new Date(cfg.last_webhook_at).toLocaleString(locale))
                    : p.noEvents}
                </span>
              </dd>
            </div>
          </dl>
        )}
        {stripe?.status === 'connected' &&
          cfg.webhook?.setup === 'manual' &&
          !cfg.last_webhook_at && (
            <p className="sb:text-xs sb:text-zinc-600">
              {p.listenHint}{' '}
              <code className="sb:break-all sb:rounded sb:bg-zinc-100 sb:px-1">
                stripe listen{cfg.mode === 'live' ? ' --live' : ''} --forward-to {cfg.webhook.url}
              </code>
            </p>
          )}
        {connect.data && connect.data.next_steps.length > 0 && (
          <Alert tone="amber">
            <ul className="sb:list-disc sb:pl-4">
              {connect.data.next_steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </Alert>
        )}

        {cfg.mode === 'live' && stripe?.status === 'connected' && (
          <div
            className="sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:p-3"
            data-testid="live-check"
          >
            <p className="sb:text-sm sb:font-medium">{p.liveCheck}</p>
            <p className="sb:mb-2 sb:text-xs sb:text-zinc-500">{p.liveCheckHint}</p>
            {check?.status === 'refunded' && (
              <Alert tone="green">
                {p.checkDone(formatMoney(check.amount, check.currency, locale))}
              </Alert>
            )}
            {check?.status === 'refund_failed' && (
              <Alert>{p.checkRefundFailed(check.error ?? '')}</Alert>
            )}
            {check?.status === 'pending' && !liveCheck.data && (
              <Alert tone="amber">{p.checkPending}</Alert>
            )}
            {liveCheck.data && check?.status === 'pending' && (
              <Alert tone="amber">
                {p.checkPay}{' '}
                <a
                  href={liveCheck.data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="sb:underline"
                >
                  {p.openCheckout}
                </a>
              </Alert>
            )}
            {check?.status !== 'refunded' &&
              (confirmingCheck ? (
                <div className="sb:mt-2 sb:flex sb:flex-col sb:gap-2">
                  <Alert tone="amber">{p.checkConfirm}</Alert>
                  <div className="sb:flex sb:gap-2">
                    <Button onClick={() => liveCheck.mutate()} disabled={liveCheck.isPending}>
                      {p.checkYes}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmingCheck(false)}>
                      {p.back}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="sb:mt-2"
                  onClick={() => setConfirmingCheck(true)}
                >
                  {p.checkStart}
                </Button>
              ))}
            <ErrorAlert error={liveCheck.error} />
          </div>
        )}

        <form
          className="sb:grid sb:gap-4 sb:md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={t.settings.secretKey} hint={p.keyHint}>
            <Input
              type="password"
              autoComplete="off"
              value={secretKey}
              onChange={(e) => {
                setSecretKey(e.target.value);
                setConfirmingLive(false);
              }}
            />
          </Field>
          <Field label={t.settings.webhookSecret} hint={p.webhookSecretHint}>
            <Input
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </Field>
          {confirmingLive && (
            <div className="sb:md:col-span-2">
              <Alert tone="amber">{p.liveConfirm}</Alert>
            </div>
          )}
          <div className="sb:flex sb:flex-wrap sb:gap-2 sb:md:col-span-2">
            <Button type="submit" disabled={!secretKey || connect.isPending}>
              {confirmingLive ? p.goLive : t.settings.connect}
            </Button>
            {confirmingLive && (
              <Button type="button" variant="ghost" onClick={() => setConfirmingLive(false)}>
                {p.back}
              </Button>
            )}
            {stripe && !confirmingLive && (
              <Button
                type="button"
                variant="outline"
                onClick={() => test.mutate()}
                disabled={test.isPending}
              >
                {t.settings.test}
              </Button>
            )}
          </div>
        </form>
        <ErrorAlert error={connect.error} />
        {test.data && <Alert tone={test.data.ok ? 'green' : 'red'}>{test.data.message}</Alert>}
      </div>
    </Card>
  );
}
