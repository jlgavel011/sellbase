import { formatMoney } from '@sellbase/sdk';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useAdmin } from '../context.js';
import { Icon, type IconName } from '../icons.js';
import { Link, useRouter } from '../router.js';
import { Page, siteUrlOf, useSlot, useStore } from '../shell.js';
import { Banner, Button, Card, CopyButton, ErrorAlert, Skeleton, cx } from '../ui.js';

/** What to ask the store's AI for technical checks the admin cannot fix by itself. */
const PROMPTS: Record<string, string> = {
  schema: 'Actualiza Sellbase en mi proyecto con `sellbase upgrade`.',
  rls: 'Revisa con `sellbase doctor` por qué hay tablas de Sellbase sin RLS y corrígelo.',
  jobs: 'Configura los jobs programados de Sellbase (pg_cron) en mi proyecto de Supabase.',
  webhook_guard:
    'Quita SELLBASE_WEBHOOKS_ALLOW_PRIVATE de los secretos de mi proyecto de Supabase en la nube.',
};

const GUIDE_KEY = 'sellbase-admin-guide-hidden';

interface Step {
  id: string;
  icon: IconName;
  done: boolean;
  to: string;
}

export function HomePage() {
  const { sellbase, t, session } = useAdmin();
  const doctor = useQuery({
    queryKey: ['sellbase-admin', 'doctor'],
    queryFn: () => sellbase.admin.doctor(),
  });
  const store = useStore();
  const top = useSlot('home.top');
  const bottom = useSlot('home.bottom');
  const checks = new Map(doctor.data?.checks.map((c) => [c.id, c]) ?? []);
  const ok = (id: string) => checks.get(id)?.status === 'ok';
  const settings = (store.data?.settings ?? {}) as { shipping?: { flat_rate_amount?: number } };

  const steps: Step[] = [
    { id: 'catalog', icon: 'products', done: ok('catalog'), to: '/products/new' },
    {
      id: 'brand',
      icon: 'store',
      done: Boolean(store.data?.logo_url && store.data?.contact_email),
      to: '/settings/general',
    },
    { id: 'payments', icon: 'card', done: ok('payments'), to: '/settings/payments' },
    {
      id: 'shipping',
      icon: 'truck',
      done: settings.shipping?.flat_rate_amount !== undefined,
      to: '/settings/shipping',
    },
    { id: 'email', icon: 'mail', done: ok('email'), to: '/settings/notifications' },
    { id: 'webhooks', icon: 'receipt', done: ok('webhooks'), to: '/settings/payments' },
    {
      id: 'site',
      icon: 'globe',
      done: Boolean(siteUrlOf(store.data?.settings)),
      to: '/settings/checkout',
    },
  ];
  const technical = (doctor.data?.checks ?? []).filter(
    (c) => c.status === 'fail' && ['schema', 'rls', 'jobs', 'webhook_guard'].includes(c.id),
  );
  const who = session?.user.email?.split('@')[0] ?? '';

  return (
    <Page title={t.home.title} subtitle={t.setup.greeting(who)}>
      {top}
      <ErrorAlert error={doctor.error} />
      {technical.map((c) => (
        <Banner
          key={c.id}
          tone="critical"
          title={t.home.checks[c.id] ?? c.label}
          actions={
            PROMPTS[c.id] && (
              <CopyButton
                value={PROMPTS[c.id] ?? ''}
                label={`${t.home.askAi} · ${t.home.copy}`}
                copiedLabel={t.home.copied}
              />
            )
          }
        >
          {c.message} {c.hint}
        </Banner>
      ))}
      {doctor.isLoading || store.isLoading ? (
        <div className="sba-card sb:flex sb:flex-col sb:gap-3 sb:p-4">
          <Skeleton className="sb:h-5 sb:w-48" />
          <Skeleton className="sb:h-3 sb:w-32" />
          <Skeleton className="sb:h-12" />
        </div>
      ) : (
        <SetupGuide steps={steps} />
      )}
      <Metrics />
      <Todo />
      {bottom}
    </Page>
  );
}

function SetupGuide({ steps }: { steps: Step[] }) {
  const { t } = useAdmin();
  const { navigate } = useRouter();
  const done = steps.filter((s) => s.done).length;
  const firstPending = steps.find((s) => !s.done)?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(firstPending);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setHide = (value: boolean) => {
    setHidden(value);
    try {
      if (value) localStorage.setItem(GUIDE_KEY, '1');
      else localStorage.removeItem(GUIDE_KEY);
    } catch {
      // private mode: remember only for this visit
    }
  };
  const all = done === steps.length;

  if (hidden)
    return (
      <div>
        <Button variant="plain" onClick={() => setHide(false)}>
          {t.setup.show} ({t.setup.progress(done, steps.length)})
        </Button>
      </div>
    );

  return (
    <Card padded={false} testId="setup-guide">
      <div className="sb:flex sb:items-start sb:justify-between sb:gap-3 sb:p-4">
        <div className="sb:flex sb:flex-col sb:gap-1">
          <h2 className="sb:text-sm sb:font-semibold sb:text-[var(--sba-text-strong)]">
            {t.setup.title}
          </h2>
          <p className="sb:text-[var(--sba-text-subdued)]">
            {all ? t.setup.allDone : t.setup.intro}
          </p>
          <div className="sb:mt-1 sb:flex sb:items-center sb:gap-2">
            <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
              {t.setup.progress(done, steps.length)}
            </span>
            <span
              className="sb:h-1.5 sb:w-28 sb:overflow-hidden sb:rounded-full sb:bg-[#e3e3e3]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={done}
              aria-label={t.setup.title}
            >
              <span
                className="sb:block sb:h-full sb:rounded-full sb:bg-[#1a1a1a] sb:transition-all"
                style={{ width: `${(done / steps.length) * 100}%` }}
              />
            </span>
          </div>
        </div>
        <Button
          variant="tertiary"
          size="sm"
          icon="x"
          aria-label={t.setup.hide}
          onClick={() => setHide(true)}
        />
      </div>
      <ul className="sb:flex sb:flex-col sb:gap-0.5 sb:px-2 sb:pb-2">
        {steps.map((step) => {
          const copy = t.setup.steps[step.id] ?? t.setup.steps.other ?? { action: '' };
          const expanded = openId === step.id;
          return (
            <li
              key={step.id}
              className={cx('sb:rounded-lg', expanded && 'sb:bg-[var(--sba-surface-subdued)]')}
              data-testid={`setup-step-${step.id}`}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : step.id)}
                className="sb:flex sb:w-full sb:cursor-pointer sb:items-center sb:gap-2.5 sb:rounded-lg sb:px-2 sb:py-2 sb:text-left sb:hover:bg-[var(--sba-surface-hover)]"
              >
                {step.done ? (
                  <Icon
                    name="checkCircle"
                    className="sb:h-5 sb:w-5 sb:shrink-0 sb:text-[var(--sba-brand-strong)]"
                    title={t.setup.done}
                  />
                ) : (
                  <Icon
                    name="dashedCircle"
                    className="sb:h-5 sb:w-5 sb:shrink-0 sb:text-[#8a8a8a]"
                    title={t.setup.pending}
                  />
                )}
                <span
                  className={cx(
                    'sb:flex-1 sb:font-semibold',
                    step.done
                      ? 'sb:text-[var(--sba-text-subdued)]'
                      : 'sb:text-[var(--sba-text-strong)]',
                  )}
                >
                  {copy.title}
                </span>
              </button>
              {expanded && (
                <div className="sb:flex sb:gap-4 sb:px-2 sb:pb-3 sb:pl-10">
                  <div className="sb:flex sb:flex-1 sb:flex-col sb:items-start sb:gap-3">
                    <p className="sb:text-[var(--sba-text-subdued)]">{copy.body}</p>
                    <Button
                      variant={step.done ? 'secondary' : 'primary'}
                      onClick={() => navigate(step.to)}
                    >
                      {copy.action}
                    </Button>
                  </div>
                  <span className="sb:hidden sb:h-20 sb:w-20 sb:shrink-0 sb:place-items-center sb:rounded-2xl sb:bg-gradient-to-br sb:from-emerald-100 sb:to-emerald-50 sb:text-emerald-700 sb:sm:grid">
                    <Icon name={step.icon} className="sb:h-9 sb:w-9" />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Sales and pending work from GET /reports/summary. */
function Metrics() {
  const { sellbase, t, config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const report = useQuery({
    queryKey: ['sellbase-admin', 'report-summary'],
    queryFn: () => sellbase.admin.reports.summary(),
  });
  if (report.isLoading)
    return (
      <div className="sba-card sb:grid sb:gap-4 sb:p-4 sb:sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="sb:flex sb:flex-col sb:gap-2">
            <Skeleton className="sb:h-3 sb:w-24" />
            <Skeleton className="sb:h-6 sb:w-32" />
          </div>
        ))}
      </div>
    );
  if (report.error) return <ErrorAlert error={report.error} />;
  const r = report.data;
  if (!r) return null;
  const money = (n: number) => formatMoney(n, r.currency, locale);
  const period = (p: typeof r.sales.today) =>
    `${t.home.ordersCount(p.orders)}${p.orders ? ` · ${t.home.average} ${money(p.average_order_amount)}` : ''}`;
  const max = Math.max(1, ...r.daily.map((d) => d.amount));
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );

  return (
    <>
      <div className="sba-card sb:grid sb:divide-y sb:divide-[var(--sba-border)] sb:sm:grid-cols-3 sb:sm:divide-x sb:sm:divide-y-0">
        <Stat
          label={t.home.today}
          value={money(r.sales.today.amount)}
          detail={period(r.sales.today)}
          testId="metric-today"
        />
        <Stat
          label={t.home.last7}
          value={money(r.sales.last_7_days.amount)}
          detail={period(r.sales.last_7_days)}
        />
        <Stat
          label={t.home.last30}
          value={money(r.sales.last_30_days.amount)}
          detail={period(r.sales.last_30_days)}
          testId="metric-30"
        />
      </div>
      <div className="sb:grid sb:gap-4 sb:lg:grid-cols-[2fr_1fr]">
        <Card title={t.home.salesChart}>
          <div
            className="sb:flex sb:h-36 sb:items-end sb:gap-[3px]"
            role="img"
            aria-label={t.home.salesChart}
          >
            {r.daily.map((d) => (
              <div
                key={d.date}
                title={`${dayLabel(d.date)}: ${money(d.amount)} · ${t.home.ordersCount(d.orders)}`}
                className={cx(
                  'sb:flex-1 sb:rounded-t-[3px] sb:transition-opacity sb:hover:opacity-80',
                  d.amount ? 'sb:bg-[var(--sba-brand)]' : 'sb:bg-[#e3e3e3]',
                )}
                style={{ height: `${Math.max(d.amount ? 4 : 2, (d.amount / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="sb:mt-2 sb:flex sb:justify-between sb:text-xs sb:text-[var(--sba-text-subdued)]">
            <span>{dayLabel(r.daily[0]?.date ?? '')}</span>
            <span>{dayLabel(r.daily.at(-1)?.date ?? '')}</span>
          </div>
        </Card>
        <Card title={t.home.topProducts}>
          {r.top_products.length === 0 ? (
            <p className="sb:text-[var(--sba-text-subdued)]">{t.home.noSales}</p>
          ) : (
            <ol className="sb:flex sb:flex-col sb:gap-2.5">
              {r.top_products.map((p, i) => (
                <li key={`${p.product_id}-${p.title}`} className="sb:flex sb:items-center sb:gap-2">
                  <span className="sb:grid sb:h-6 sb:w-6 sb:shrink-0 sb:place-items-center sb:rounded-md sb:bg-[var(--sba-surface-subdued)] sb:text-xs sb:font-semibold">
                    {i + 1}
                  </span>
                  <span className="sb:min-w-0 sb:flex-1">
                    {p.product_id ? (
                      <Link
                        to={`/products/${p.product_id}`}
                        className="sb:block sb:truncate sb:font-medium sb:hover:underline"
                      >
                        {p.title}
                      </Link>
                    ) : (
                      <span className="sb:block sb:truncate sb:font-medium">{p.title}</span>
                    )}
                    <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      {t.home.units(p.quantity)}
                    </span>
                  </span>
                  <span className="sb:font-semibold">{money(p.amount)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  testId?: string;
}) {
  return (
    <div className="sb:flex sb:flex-col sb:gap-1 sb:p-4" data-testid={testId}>
      <span className="sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">{label}</span>
      <span className="sb:text-2xl sb:font-bold sb:tracking-tight sb:text-[var(--sba-text-strong)]">
        {value}
      </span>
      {detail && <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{detail}</span>}
    </div>
  );
}

/** Things that need the owner today, each linking to where it is solved. */
function Todo() {
  const { sellbase, t } = useAdmin();
  const counts = useQuery({
    queryKey: ['sellbase-admin', 'home-todo'],
    queryFn: async () => {
      const [report, unpaid, abandoned, low] = await Promise.all([
        sellbase.admin.reports.summary(),
        sellbase.admin.orders
          .search({ status: 'pending_payment', limit: 100 })
          .catch(() => ({ data: [] })),
        sellbase.admin.checkouts
          .abandoned({ status: 'abandoned', limit: 100 })
          .catch(() => ({ data: [] })),
        sellbase.admin.inventory.list({ stock: 'low', limit: 100 }).catch(() => ({ data: [] })),
      ]);
      return {
        toFulfill: report.orders_to_fulfill,
        bookings: report.bookings_today,
        unpaid: unpaid.data.length,
        abandoned: abandoned.data.filter((c) => !c.recovery_sent_at).length,
        low: low.data.length,
      };
    },
  });
  const c = counts.data;
  if (!c) return null;
  const rows: { show: boolean; icon: IconName; text: string; to: string; testId?: string }[] = [
    {
      show: c.toFulfill > 0,
      icon: 'orders',
      text: t.setup.toFulfill(c.toFulfill),
      to: '/orders',
      testId: 'metric-to-fulfill',
    },
    { show: c.unpaid > 0, icon: 'clock', text: t.setup.unpaid(c.unpaid), to: '/orders' },
    {
      show: c.abandoned > 0,
      icon: 'cart',
      text: t.setup.abandoned(c.abandoned),
      to: '/orders/abandoned',
    },
    {
      show: c.low > 0,
      icon: 'inventory',
      text: t.setup.lowStock(c.low),
      to: '/products/inventory',
    },
    {
      show: c.bookings > 0,
      icon: 'calendar',
      text: `${t.home.bookingsToday}: ${c.bookings}`,
      to: '/agenda',
    },
  ];
  const visible = rows.filter((r) => r.show);
  return (
    <Card title={t.setup.todo} padded={false}>
      {visible.length === 0 ? (
        <p className="sb:flex sb:items-center sb:gap-2 sb:px-4 sb:pb-4 sb:text-[var(--sba-text-subdued)]">
          <Icon name="checkCircle" className="sb:h-5 sb:w-5 sb:text-[var(--sba-brand-strong)]" />
          {t.setup.allClear}
        </p>
      ) : (
        <ul className="sb:flex sb:flex-col sb:pb-2">
          {visible.map((r) => (
            <TodoRow key={r.to + r.text} {...r} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TodoRow({
  icon,
  text,
  to,
  testId,
}: {
  icon: IconName;
  text: ReactNode;
  to: string;
  testId?: string;
}) {
  return (
    <li data-testid={testId}>
      <Link
        to={to}
        className="sb:mx-2 sb:flex sb:items-center sb:gap-3 sb:rounded-lg sb:px-2 sb:py-2 sb:hover:bg-[var(--sba-surface-hover)]"
      >
        <span className="sb:grid sb:h-8 sb:w-8 sb:place-items-center sb:rounded-lg sb:bg-[var(--sba-surface-subdued)]">
          <Icon name={icon} className="sb:h-4 sb:w-4" />
        </span>
        <span className="sb:flex-1 sb:font-medium sb:text-[var(--sba-text-strong)]">{text}</span>
        <Icon name="chevronRight" className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
      </Link>
    </li>
  );
}
