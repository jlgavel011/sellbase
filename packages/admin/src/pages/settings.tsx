import { formatMoney, toDecimalString, toMinorUnits } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAdmin } from '../context.js';
import { Icon, type IconName } from '../icons.js';
import { Link, useRouter } from '../router.js';
import { Page, useSaveBar, useSlot, useStore } from '../shell.js';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Input,
  InputGroup,
  PageSkeleton,
  Select,
  Switch,
  cx,
  readFileAsBase64,
  useToast,
} from '../ui.js';
import { PaymentsCard } from './payments-card.js';
import { AgentsPage, TeamPage, WebhooksPage } from './settings-sections.js';

const SECTIONS: { id: string; icon: IconName }[] = [
  { id: 'general', icon: 'store' },
  { id: 'payments', icon: 'card' },
  { id: 'shipping', icon: 'truck' },
  { id: 'taxes', icon: 'receipt' },
  { id: 'checkout', icon: 'cart' },
  { id: 'notifications', icon: 'bell' },
  { id: 'team', icon: 'users' },
  { id: 'agents', icon: 'bot' },
  { id: 'webhooks', icon: 'webhook' },
  { id: 'integrations', icon: 'plug' },
];

/** Settings with a section list on the left (Shopify's settings layout). */
export function SettingsPage({ section = 'general' }: { section?: string }) {
  const { t } = useAdmin();
  const bottom = useSlot('settings.bottom');
  const current = SECTIONS.some((s) => s.id === section) ? section : 'general';
  const body: Record<string, ReactNode> = {
    general: <GeneralSettings />,
    payments: <PaymentsCard />,
    shipping: <ShippingSettings />,
    taxes: <TaxSettings />,
    checkout: <CheckoutSettings />,
    notifications: <NotificationSettings />,
    team: <TeamPage />,
    agents: <AgentsPage />,
    webhooks: <WebhooksPage />,
    integrations: <IntegrationsSettings />,
  };
  return (
    <Page title={t.settingsNav.title} width="wide">
      <div className="sb:grid sb:items-start sb:gap-4 sb:lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav
          aria-label={t.settingsNav.title}
          className="sba-card sb:flex sb:gap-0.5 sb:overflow-x-auto sb:p-1.5 sb:lg:sticky sb:lg:top-20 sb:lg:flex-col"
        >
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={`/settings/${s.id}`}
              className={cx(
                'sb:flex sb:shrink-0 sb:items-center sb:gap-2.5 sb:rounded-lg sb:px-2.5 sb:py-2 sb:font-medium sb:hover:bg-[var(--sba-surface-hover)]',
                current === s.id &&
                  'sb:bg-[var(--sba-surface-selected)] sb:font-semibold sb:text-[var(--sba-text-strong)]',
              )}
              {...(current === s.id ? { 'aria-current': 'page' as const } : {})}
            >
              <Icon name={s.icon} className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
              {t.settingsNav.sections[s.id]}
            </Link>
          ))}
        </nav>
        <section
          className="sb:flex sb:min-w-0 sb:flex-col sb:gap-4"
          aria-labelledby="settings-section-title"
        >
          <div>
            <h2
              id="settings-section-title"
              className="sb:text-base sb:font-semibold sb:text-[var(--sba-text-strong)]"
            >
              {t.settingsNav.sections[current]}
            </h2>
            <p className="sb:text-[var(--sba-text-subdued)]">
              {t.settingsNav.descriptions[current]}
            </p>
          </div>
          {body[current]}
          {current === 'general' && bottom}
        </section>
      </div>
    </Page>
  );
}

// ── Shared form helpers ──────────────────────────────────────────────────────

type StoreData = NonNullable<ReturnType<typeof useStore>['data']>;

/**
 * Local form state for a settings section, with the contextual save bar. `read` builds
 * the form from the store; `write` builds the PATCH /store body.
 */
function useStoreForm<T>(
  read: (s: StoreData) => T,
  write: (
    f: T,
    s: StoreData,
  ) => Parameters<ReturnType<typeof useAdmin>['sellbase']['admin']['store']['update']>[0],
) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const store = useStore();
  const [initial, setInitial] = useState<T | null>(null);
  const [form, setForm] = useState<T | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    if (!store.data) return;
    const next = readRef.current(store.data);
    setInitial(next);
    setForm(next);
  }, [store.data]);
  const save = useMutation({
    mutationFn: () => sellbase.admin.store.update(write(form as T, store.data as StoreData)),
    onSuccess: (next) => {
      qc.setQueryData(['sellbase-admin', 'store'], next);
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'doctor'] });
      toast(t.general.saved);
    },
    onError: (e) => toast((e as { message?: string }).message ?? t.common.error, { error: true }),
  });
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(initial);
  useSaveBar(
    dirty
      ? { onSave: () => save.mutate(), onDiscard: () => setForm(initial), saving: save.isPending }
      : null,
  );
  return {
    store,
    form,
    setForm: (patch: Partial<T>) => setForm((f) => (f ? { ...f, ...patch } : f)),
    save,
    dirty,
  };
}

function SaveRow({
  dirty,
  saving,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { t } = useAdmin();
  return (
    <div className="sb:flex sb:justify-end">
      <Button onClick={onSave} disabled={!dirty} loading={saving}>
        {t.settings.save}
      </Button>
    </div>
  );
}

// ── General ──────────────────────────────────────────────────────────────────

function GeneralSettings() {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const g = t.general;
  const { store, form, setForm, save, dirty } = useStoreForm(
    (s) => ({
      name: s.name,
      email: s.contact_email ?? '',
      color: (s.settings as { brand_color?: string }).brand_color ?? '#111111',
    }),
    (f) => ({ name: f.name, contact_email: f.email || null, settings: { brand_color: f.color } }),
  );
  const upload = useMutation({
    mutationFn: async (file: File) =>
      sellbase.admin.store.uploadLogo({
        file_name: file.name,
        content_base64: await readFileAsBase64(file),
      }),
    onSuccess: (next) => {
      qc.setQueryData(['sellbase-admin', 'store'], next);
      toast(g.logoSaved);
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const removeLogo = useMutation({
    mutationFn: () => sellbase.admin.store.update({ logo_url: null }),
    onSuccess: (next) => qc.setQueryData(['sellbase-admin', 'store'], next),
  });
  if (!form || !store.data) return <PageSkeleton />;

  return (
    <>
      <Card title={g.details}>
        <div className="sb:grid sb:gap-3 sb:md:grid-cols-2">
          <Field label={t.settings.storeName}>
            <Input required value={form.name} onChange={(e) => setForm({ name: e.target.value })} />
          </Field>
          <Field label={t.settings.contactEmail} hint={g.contactHint}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ email: e.target.value })}
            />
          </Field>
        </div>
      </Card>
      <Card title={g.brand}>
        <div className="sb:flex sb:flex-col sb:gap-4">
          <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-4">
            <span className="sb:grid sb:h-20 sb:w-20 sb:place-items-center sb:overflow-hidden sb:rounded-xl sb:border sb:border-dashed sb:border-[#b5b5b5] sb:bg-[var(--sba-surface-subdued)]">
              {store.data.logo_url ? (
                <img
                  src={store.data.logo_url}
                  alt={g.logo}
                  className="sb:max-h-full sb:max-w-full sb:object-contain"
                />
              ) : (
                <Icon name="image" className="sb:h-6 sb:w-6 sb:text-[var(--sba-text-subdued)]" />
              )}
            </span>
            <div className="sb:flex sb:flex-col sb:gap-2">
              <span className="sb:font-semibold">{g.logo}</span>
              <div className="sb:flex sb:gap-2">
                <label
                  className={cx('sba-btn sba-btn-secondary', upload.isPending && 'sb:opacity-50')}
                >
                  <Icon name="upload" className="sb:h-4 sb:w-4" />
                  {store.data.logo_url ? g.changeLogo : g.uploadLogo}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sb:sr-only"
                    aria-label={g.uploadLogo}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                {store.data.logo_url && (
                  <Button variant="tertiary" onClick={() => removeLogo.mutate()}>
                    {g.removeLogo}
                  </Button>
                )}
              </div>
              <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{g.logoHint}</span>
            </div>
          </div>
          <Field label={g.color} hint={g.colorHint} className="sb:w-fit">
            <span className="sb:flex sb:items-center sb:gap-2">
              <input
                type="color"
                aria-label={g.color}
                value={form.color}
                onChange={(e) => setForm({ color: e.target.value })}
                className="sb:h-8 sb:w-10 sb:cursor-pointer sb:rounded-md sb:border sb:border-[#b5b5b5] sb:p-0.5"
              />
              <Input
                value={form.color}
                onChange={(e) => setForm({ color: e.target.value })}
                className="sb:w-28 sb:font-mono"
              />
            </span>
          </Field>
        </div>
      </Card>
      <Card title={g.regional}>
        <dl className="sb:grid sb:gap-3 sb:sm:grid-cols-3">
          <div>
            <dt className="sb:text-[var(--sba-text-subdued)]">{g.currency}</dt>
            <dd className="sb:font-semibold">{store.data.default_currency}</dd>
          </div>
          <div>
            <dt className="sb:text-[var(--sba-text-subdued)]">{g.country}</dt>
            <dd className="sb:font-semibold">{store.data.country}</dd>
          </div>
          <div>
            <dt className="sb:text-[var(--sba-text-subdued)]">{g.timezone}</dt>
            <dd className="sb:font-semibold">{store.data.timezone}</dd>
          </div>
        </dl>
        <p className="sb:mt-3 sb:text-xs sb:text-[var(--sba-text-subdued)]">{g.regionalHint}</p>
      </Card>
      <SaveRow dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} />
    </>
  );
}

// ── Shipping ─────────────────────────────────────────────────────────────────

interface ShippingSettingsValue {
  flat_rate_amount?: number;
  free_over_amount?: number | null;
  pickup?: { enabled?: boolean };
}

function ShippingSettings() {
  const { t, config } = useAdmin();
  const sh = t.shippingSettings;
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const { store, form, setForm, save, dirty } = useStoreForm(
    (s) => {
      const shipping = ((s.settings as { shipping?: ShippingSettingsValue }).shipping ??
        {}) as ShippingSettingsValue;
      return {
        flat:
          shipping.flat_rate_amount !== undefined
            ? toDecimalString(shipping.flat_rate_amount, s.default_currency)
            : '',
        freeOver: shipping.free_over_amount
          ? toDecimalString(shipping.free_over_amount, s.default_currency)
          : '',
        pickup: Boolean(shipping.pickup?.enabled),
      };
    },
    (f, s) => ({
      settings: {
        shipping: {
          flat_rate_amount: toMinorUnits(f.flat || '0', s.default_currency),
          free_over_amount: f.freeOver ? toMinorUnits(f.freeOver, s.default_currency) : null,
          pickup: { enabled: f.pickup },
        },
      },
    }),
  );
  if (!form || !store.data) return <PageSkeleton />;
  const currency = store.data.default_currency;
  const safe = (v: string) => {
    try {
      return formatMoney(toMinorUnits(v || '0', currency), currency, locale);
    } catch {
      return '—';
    }
  };
  return (
    <>
      <Card title={sh.rates}>
        <div className="sb:flex sb:flex-col sb:gap-4">
          <p className="sb:text-[var(--sba-text-subdued)]">{sh.ratesHint}</p>
          <div className="sb:grid sb:gap-3 sb:md:grid-cols-2">
            <Field label={t.settings.flatRate}>
              <InputGroup
                prefix="$"
                suffix={currency}
                inputMode="decimal"
                placeholder="99.00"
                aria-label={t.settings.flatRate}
                value={form.flat}
                onChange={(e) => setForm({ flat: e.target.value })}
              />
            </Field>
            <Field label={t.settings.freeOver} hint={sh.freeOverHint}>
              <InputGroup
                prefix="$"
                suffix={currency}
                inputMode="decimal"
                placeholder="999.00"
                aria-label={t.settings.freeOver}
                value={form.freeOver}
                onChange={(e) => setForm({ freeOver: e.target.value })}
              />
            </Field>
          </div>
          <Switch
            label={t.settings.pickup}
            hint={sh.pickupHint}
            checked={form.pickup}
            onChange={(pickup) => setForm({ pickup })}
          />
        </div>
      </Card>
      <Card title={sh.preview} subdued>
        <ul className="sb:flex sb:flex-col sb:gap-2">
          <li className="sb:flex sb:items-center sb:justify-between sb:rounded-lg sb:border sb:border-[var(--sba-border)] sb:bg-white sb:px-3 sb:py-2.5">
            <span className="sb:flex sb:items-center sb:gap-2">
              <Icon name="truck" className="sb:h-4 sb:w-4" />
              {sh.flat}
              {form.freeOver && (
                <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                  · {sh.previewFree(safe(form.freeOver))}
                </span>
              )}
            </span>
            <span className="sb:font-semibold">
              {form.flat && Number(form.flat) > 0 ? safe(form.flat) : sh.free}
            </span>
          </li>
          {form.pickup && (
            <li className="sb:flex sb:items-center sb:justify-between sb:rounded-lg sb:border sb:border-[var(--sba-border)] sb:bg-white sb:px-3 sb:py-2.5">
              <span className="sb:flex sb:items-center sb:gap-2">
                <Icon name="store" className="sb:h-4 sb:w-4" />
                {sh.pickup}
              </span>
              <span className="sb:font-semibold">{sh.free}</span>
            </li>
          )}
        </ul>
      </Card>
      <SaveRow dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} />
    </>
  );
}

// ── Taxes ────────────────────────────────────────────────────────────────────

function TaxSettings() {
  const { t, config } = useAdmin();
  const tx = t.taxSettings;
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const { store, form, setForm, save, dirty } = useStoreForm(
    (s) => {
      const tax =
        (
          s.settings as {
            tax?: { rate_bps?: number; mode?: string; applies_to_shipping?: boolean };
          }
        ).tax ?? {};
      return {
        rate: String((tax.rate_bps ?? 0) / 100),
        included: (tax.mode ?? 'inclusive') === 'inclusive',
        shipping: tax.applies_to_shipping ?? true,
      };
    },
    (f) => ({
      settings: {
        tax: {
          rate_bps: Math.round(Number(f.rate || 0) * 100),
          mode: f.included ? ('inclusive' as const) : ('exclusive' as const),
          applies_to_shipping: f.shipping,
        },
      },
    }),
  );
  if (!form || !store.data) return <PageSkeleton />;
  const currency = store.data.default_currency;
  const price = 100_000;
  const rate = Number(form.rate || 0) / 100;
  const tax = form.included ? Math.round(price - price / (1 + rate)) : Math.round(price * rate);
  return (
    <>
      <Card title={tx.title}>
        <div className="sb:flex sb:flex-col sb:gap-4">
          <Field label={t.settings.taxRate} className="sb:w-40">
            <InputGroup
              suffix="%"
              inputMode="decimal"
              aria-label={t.settings.taxRate}
              value={form.rate}
              onChange={(e) => setForm({ rate: e.target.value.replace(/[^\d.]/g, '') })}
            />
          </Field>
          <Checkbox
            label={tx.included}
            hint={tx.includedHint}
            checked={form.included}
            onChange={(e) => setForm({ included: e.target.checked })}
          />
          <Checkbox
            label={tx.shipping}
            checked={form.shipping}
            onChange={(e) => setForm({ shipping: e.target.checked })}
          />
          <p className="sb:rounded-lg sb:bg-[var(--sba-surface-subdued)] sb:px-3 sb:py-2 sb:text-[var(--sba-text-subdued)]">
            {tx.example(formatMoney(price, currency, locale), formatMoney(tax, currency, locale))}
          </p>
        </div>
      </Card>
      <SaveRow dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} />
    </>
  );
}

// ── Checkout ─────────────────────────────────────────────────────────────────

function CheckoutSettings() {
  const { t } = useAdmin();
  const c = t.checkoutSettings;
  const { store, form, setForm, save, dirty } = useStoreForm(
    (s) => {
      const st = s.settings as {
        site_url?: string;
        download_page_url?: string | null;
        checkout?: { required_consent?: string | null };
        abandoned_checkout?: { auto_email?: boolean; delay_hours?: number };
      };
      return {
        site: st.site_url ?? '',
        consentOn: Boolean(st.checkout?.required_consent),
        consent: st.checkout?.required_consent ?? '',
        downloads: st.download_page_url ?? '',
        auto: Boolean(st.abandoned_checkout?.auto_email),
        delay: String(st.abandoned_checkout?.delay_hours ?? 2),
      };
    },
    (f) => ({
      settings: {
        ...(f.site ? { site_url: f.site.trim() } : {}),
        download_page_url: f.downloads.trim() || null,
        checkout: {
          required_consent: f.consentOn ? f.consent.trim() || c.consentPlaceholder : null,
        },
        abandoned_checkout: { auto_email: f.auto && Boolean(f.site), delay_hours: Number(f.delay) },
      },
    }),
  );
  if (!form || !store.data) return <PageSkeleton />;
  return (
    <>
      <Card title={c.site}>
        <Field label={c.siteUrl} hint={c.siteUrlHint}>
          <Input
            type="url"
            placeholder="https://mitienda.com"
            value={form.site}
            onChange={(e) => setForm({ site: e.target.value })}
          />
        </Field>
      </Card>
      <Card title={c.consent}>
        <div className="sb:flex sb:flex-col sb:gap-3">
          <Switch
            label={c.consentToggle}
            hint={c.consentHint}
            checked={form.consentOn}
            onChange={(consentOn) => setForm({ consentOn })}
          />
          {form.consentOn && (
            <>
              <Field label={c.consentText}>
                <Input
                  value={form.consent}
                  maxLength={300}
                  placeholder={c.consentPlaceholder}
                  onChange={(e) => setForm({ consent: e.target.value })}
                />
              </Field>
              <label
                className="sb:flex sb:items-start sb:gap-2 sb:rounded-lg sb:border sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:px-3 sb:py-2.5"
                aria-hidden
              >
                <input type="checkbox" className="sba-checkbox" disabled />
                <span>{form.consent || c.consentPlaceholder}</span>
              </label>
            </>
          )}
        </div>
      </Card>
      <Card title={c.abandoned}>
        <div className="sb:flex sb:flex-col sb:gap-3">
          {!form.site && <Banner tone="info">{c.needsSite}</Banner>}
          <Switch
            label={c.autoEmail}
            hint={c.autoEmailHint}
            checked={form.auto}
            disabled={!form.site}
            onChange={(auto) => setForm({ auto })}
          />
          {form.auto && (
            <Field label={c.delay} className="sb:w-48">
              <Select value={form.delay} onChange={(e) => setForm({ delay: e.target.value })}>
                {[1, 2, 4, 10, 24].map((h) => (
                  <option key={h} value={h}>
                    {c.hours(h)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>
      <Card title={c.downloads}>
        <Field label={c.downloadsUrl} hint={c.downloadsHint}>
          <Input
            type="url"
            placeholder="https://mitienda.com/descargas/{token}"
            value={form.downloads}
            onChange={(e) => setForm({ downloads: e.target.value })}
          />
        </Field>
      </Card>
      <SaveRow dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} />
    </>
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

function NotificationSettings() {
  const { sellbase, t, session } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const n = t.notificationSettings;
  const store = useStore();
  const integrations = useQuery({
    queryKey: ['sellbase-admin', 'integrations'],
    queryFn: () => sellbase.admin.integrations.list(),
  });
  const resend = integrations.data?.data.find((i) => i.provider === 'resend');
  const connected = resend?.status === 'connected';
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(session?.user.email ?? '');
  const connect = useMutation({
    mutationFn: () => sellbase.admin.integrations.connect('resend', { secret_key: key.trim() }),
    onSuccess: (r) => {
      setKey('');
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'integrations'] });
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'doctor'] });
      if (r.integration.status === 'connected') toast(n.connected);
      else toast(r.integration.last_error ?? t.common.error, { error: true });
    },
  });
  const test = useMutation({
    mutationFn: () => sellbase.admin.integrations.testEmail(to),
    onSuccess: (r) =>
      toast(r.provider === 'log' ? n.testLogged : r.ok ? n.testSent : r.message, {
        error: !r.ok && r.provider !== 'log',
      }),
  });
  const from = `${store.data?.name ?? ''} <${store.data?.contact_email ?? 'orders@example.com'}>`;

  return (
    <>
      <Card
        title={n.provider}
        actions={
          connected ? (
            <Badge tone="green">{n.connected}</Badge>
          ) : (
            <Badge tone="amber">{n.notConnected}</Badge>
          )
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          {!connected && <Banner tone="warning">{n.notConnectedHint}</Banner>}
          {resend?.last_error && <Banner tone="critical">{resend.last_error}</Banner>}
          {connected && !editing ? (
            <div className="sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-2">
              <span className="sb:flex sb:items-center sb:gap-2">
                <Icon
                  name="checkCircle"
                  className="sb:h-5 sb:w-5 sb:text-[var(--sba-brand-strong)]"
                />
                Resend
              </span>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {n.reconnect}
              </Button>
            </div>
          ) : (
            <form
              className="sb:flex sb:flex-col sb:gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                connect.mutate();
              }}
            >
              <Field label={n.apiKey} hint={n.apiKeyHint}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </Field>
              <div>
                <Button type="submit" disabled={!key.trim()} loading={connect.isPending}>
                  {n.connect}
                </Button>
              </div>
              <ErrorAlert error={connect.error} />
            </form>
          )}
          <p className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{n.senderHint(from)}</p>
        </div>
      </Card>
      <Card title={n.test}>
        <form
          className="sb:flex sb:flex-wrap sb:items-end sb:gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            test.mutate();
          }}
        >
          <Field label={n.testTo} className="sb:min-w-56 sb:flex-1">
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button
            type="submit"
            variant="secondary"
            icon="mail"
            disabled={!to}
            loading={test.isPending}
          >
            {n.test}
          </Button>
        </form>
        <div className="sb:mt-2">
          <ErrorAlert error={test.error} />
        </div>
      </Card>
      <Card title={n.automatic}>
        <p className="sb:mb-2 sb:text-[var(--sba-text-subdued)]">{n.automaticHint}</p>
        <ul className="sb:flex sb:flex-col sb:divide-y sb:divide-[var(--sba-border)]">
          {Object.entries(n.templates).map(([id, label]) => (
            <li key={id} className="sb:flex sb:items-center sb:gap-2 sb:py-2">
              <Icon name="mail" className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
              {label}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

// ── Integrations ─────────────────────────────────────────────────────────────

function IntegrationsSettings() {
  const { sellbase, t, config } = useAdmin();
  const { navigate } = useRouter();
  const i = t.integrationsPage;
  const integrations = useQuery({
    queryKey: ['sellbase-admin', 'integrations'],
    queryFn: () => sellbase.admin.integrations.list(),
  });
  const tokens = useQuery({
    queryKey: ['sellbase-admin', 'tokens'],
    queryFn: () => sellbase.admin.tokens.list(),
  });
  const hooks = useQuery({
    queryKey: ['sellbase-admin', 'webhooks'],
    queryFn: () => sellbase.admin.webhooks.list(),
  });
  const status = (provider: string) =>
    integrations.data?.data.find((x) => x.provider === provider)?.status;
  const badge = (s: string | undefined) =>
    s === 'connected' ? (
      <Badge tone="green">{i.connected}</Badge>
    ) : s === 'error' ? (
      <Badge tone="red">{i.error}</Badge>
    ) : (
      <Badge>{i.notConnected}</Badge>
    );
  const activeTokens = tokens.data?.data.filter((x) => !x.revoked_at).length ?? 0;
  const activeHooks = hooks.data?.data.filter((x) => x.enabled).length ?? 0;
  const apiUrl =
    config.apiUrl ?? `${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/sellbase-api`;
  const rows: {
    id: string;
    icon: IconName;
    name: string;
    body: string;
    badge: ReactNode;
    to: string;
  }[] = [
    {
      id: 'stripe',
      icon: 'card',
      name: i.stripe.name,
      body: i.stripe.body,
      badge: badge(status('stripe')),
      to: '/settings/payments',
    },
    {
      id: 'resend',
      icon: 'mail',
      name: i.resend.name,
      body: i.resend.body,
      badge: badge(status('resend')),
      to: '/settings/notifications',
    },
    {
      id: 'agents',
      icon: 'bot',
      name: i.agents.name,
      body: i.agents.body,
      badge: activeTokens ? (
        <Badge tone="green">{i.active(activeTokens)}</Badge>
      ) : (
        <Badge>{i.notConnected}</Badge>
      ),
      to: '/settings/agents',
    },
    {
      id: 'webhooks',
      icon: 'webhook',
      name: i.webhooks.name,
      body: i.webhooks.body,
      badge: activeHooks ? (
        <Badge tone="green">{i.active(activeHooks)}</Badge>
      ) : (
        <Badge>{i.notConnected}</Badge>
      ),
      to: '/settings/webhooks',
    },
  ];
  return (
    <>
      <p className="sb:text-[var(--sba-text-subdued)]">{i.intro}</p>
      <Card padded={false}>
        <ul className="sb:flex sb:flex-col sb:divide-y sb:divide-[var(--sba-border)]">
          {rows.map((r) => (
            <li
              key={r.id}
              className="sb:flex sb:items-center sb:gap-3 sb:p-4"
              data-testid={`integration-${r.id}`}
            >
              <span className="sb:grid sb:h-10 sb:w-10 sb:shrink-0 sb:place-items-center sb:rounded-xl sb:bg-[var(--sba-surface-subdued)]">
                <Icon name={r.icon} />
              </span>
              <span className="sb:flex sb:min-w-0 sb:flex-1 sb:flex-col">
                <span className="sb:flex sb:flex-wrap sb:items-center sb:gap-2 sb:font-semibold sb:text-[var(--sba-text-strong)]">
                  {r.name}
                  {r.badge}
                </span>
                <span className="sb:text-[var(--sba-text-subdued)]">{r.body}</span>
              </span>
              <Button variant="secondary" onClick={() => navigate(r.to)}>
                {i.manage}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={i.api.name}>
        <p className="sb:mb-3 sb:text-[var(--sba-text-subdued)]">{i.api.body}</p>
        <Field label={i.apiUrl}>
          <Input
            readOnly
            value={apiUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="sb:font-mono sb:text-xs"
          />
        </Field>
        <a
          href={`${apiUrl}/v1/openapi.json`}
          target="_blank"
          rel="noreferrer"
          className="sb:mt-2 sb:inline-flex sb:items-center sb:gap-1 sb:font-medium sb:text-[var(--sba-link)] sb:hover:underline"
        >
          OpenAPI <Icon name="external" className="sb:h-3.5 sb:w-3.5" />
        </a>
      </Card>
    </>
  );
}
