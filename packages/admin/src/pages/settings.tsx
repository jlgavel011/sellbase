import { toDecimalString, toMinorUnits } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '../context.js';
import { PageTitle, useSlot } from '../shell.js';
import { Alert, Badge, Button, Card, ErrorAlert, Field, Input } from '../ui.js';

interface ShippingSettings {
  flat_rate_amount?: number;
  free_over_amount?: number | null;
  pickup?: { enabled?: boolean };
}

export function SettingsPage() {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const integrations = useQuery({
    queryKey: ['sellbase-admin', 'integrations'],
    queryFn: () => sellbase.admin.integrations.list(),
  });
  const bottom = useSlot('settings.bottom');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [color, setColor] = useState('#111111');
  const [taxRate, setTaxRate] = useState('16');
  const [taxIncluded, setTaxIncluded] = useState(true);
  const [flat, setFlat] = useState('');
  const [freeOver, setFreeOver] = useState('');
  const [pickup, setPickup] = useState(false);
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  useEffect(() => {
    const s = store.data;
    if (!s) return;
    const settings = s.settings as {
      brand_color?: string;
      tax?: { rate_bps?: number; mode?: string };
      shipping?: ShippingSettings;
    };
    setName(s.name);
    setEmail(s.contact_email ?? '');
    setColor(settings.brand_color ?? '#111111');
    setTaxRate(String((settings.tax?.rate_bps ?? 0) / 100));
    setTaxIncluded((settings.tax?.mode ?? 'inclusive') === 'inclusive');
    setFlat(
      settings.shipping?.flat_rate_amount !== undefined
        ? toDecimalString(settings.shipping.flat_rate_amount, s.default_currency)
        : '',
    );
    setFreeOver(
      settings.shipping?.free_over_amount
        ? toDecimalString(settings.shipping.free_over_amount, s.default_currency)
        : '',
    );
    setPickup(Boolean(settings.shipping?.pickup?.enabled));
  }, [store.data]);

  const saveStore = useMutation({
    mutationFn: () => {
      const currency = store.data?.default_currency ?? 'MXN';
      return sellbase.admin.store.update({
        name,
        contact_email: email || null,
        settings: {
          brand_color: color,
          tax: {
            rate_bps: Math.round(Number(taxRate || 0) * 100),
            mode: taxIncluded ? 'inclusive' : 'exclusive',
          },
          shipping: {
            flat_rate_amount: toMinorUnits(flat || '0', currency),
            free_over_amount: freeOver ? toMinorUnits(freeOver, currency) : null,
            pickup: { enabled: pickup },
          },
        },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'store'] }),
  });

  const stripe = integrations.data?.data.find((i) => i.provider === 'stripe');
  const connect = useMutation({
    mutationFn: () =>
      sellbase.admin.integrations.connect('stripe', {
        secret_key: secretKey,
        ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
      }),
    onSuccess: () => {
      setSecretKey('');
      setWebhookSecret('');
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'integrations'] });
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'doctor'] });
    },
  });
  const test = useMutation({ mutationFn: () => sellbase.admin.integrations.test('stripe') });

  function submitStore(e: FormEvent) {
    e.preventDefault();
    saveStore.mutate();
  }

  return (
    <>
      <PageTitle>{t.settings.title}</PageTitle>
      <div className="sb:flex sb:flex-col sb:gap-6">
        <form onSubmit={submitStore}>
          <Card title={t.settings.store}>
            <div className="sb:grid sb:gap-4 sb:md:grid-cols-2">
              <Field label={t.settings.storeName}>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t.settings.contactEmail}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label={t.settings.brandColor}>
                <Input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="sb:h-10 sb:p-1"
                />
              </Field>
              <Field label={t.settings.taxRate}>
                <Input
                  inputMode="decimal"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
              </Field>
              <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm sb:md:col-span-2">
                <input
                  type="checkbox"
                  checked={taxIncluded}
                  onChange={(e) => setTaxIncluded(e.target.checked)}
                />
                {t.settings.taxIncluded}
              </label>
            </div>
            <h3 className="sb:mb-3 sb:mt-6 sb:font-medium">{t.settings.shipping}</h3>
            <div className="sb:grid sb:gap-4 sb:md:grid-cols-2">
              <Field label={t.settings.flatRate}>
                <Input
                  inputMode="decimal"
                  placeholder="99.00"
                  value={flat}
                  onChange={(e) => setFlat(e.target.value)}
                />
              </Field>
              <Field label={t.settings.freeOver}>
                <Input
                  inputMode="decimal"
                  placeholder="999.00"
                  value={freeOver}
                  onChange={(e) => setFreeOver(e.target.value)}
                />
              </Field>
              <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
                <input
                  type="checkbox"
                  checked={pickup}
                  onChange={(e) => setPickup(e.target.checked)}
                />
                {t.settings.pickup}
              </label>
            </div>
            <div className="sb:mt-4 sb:flex sb:items-center sb:gap-3">
              <Button type="submit" disabled={saveStore.isPending}>
                {t.settings.save}
              </Button>
              {saveStore.isSuccess && (
                <span className="sb:text-sm sb:text-emerald-700">{t.settings.saved}</span>
              )}
            </div>
            <div className="sb:mt-3">
              <ErrorAlert error={saveStore.error} />
            </div>
          </Card>
        </form>

        <Card
          title={t.settings.payments}
          actions={
            stripe?.status === 'connected' ? (
              <Badge tone="green">{t.settings.stripeConnected}</Badge>
            ) : (
              <Badge tone="amber">{t.settings.stripeNotConnected}</Badge>
            )
          }
        >
          {stripe?.last_error && <Alert>{stripe.last_error}</Alert>}
          <form
            className="sb:mt-2 sb:grid sb:gap-4 sb:md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate();
            }}
          >
            <Field label={t.settings.secretKey}>
              <Input
                type="password"
                autoComplete="off"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
            </Field>
            <Field label={t.settings.webhookSecret}>
              <Input
                type="password"
                autoComplete="off"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </Field>
            <div className="sb:flex sb:flex-wrap sb:gap-2 sb:md:col-span-2">
              <Button type="submit" disabled={!secretKey || connect.isPending}>
                {t.settings.connect}
              </Button>
              {stripe && (
                <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                  {t.settings.test}
                </Button>
              )}
            </div>
          </form>
          <div className="sb:mt-3 sb:flex sb:flex-col sb:gap-2">
            <ErrorAlert error={connect.error} />
            {test.data && <Alert tone={test.data.ok ? 'green' : 'red'}>{test.data.message}</Alert>}
          </div>
        </Card>
        {bottom}
      </div>
    </>
  );
}
