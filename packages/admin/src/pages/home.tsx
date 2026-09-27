import { formatMoney } from '@sellbase/sdk';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { PageTitle, useSlot } from '../shell.js';
import { Link } from '../router.js';
import { Badge, Button, Card, ErrorAlert, Spinner } from '../ui.js';

/** What to ask the store's AI for each pending doctor check. */
const PROMPTS: Record<string, string> = {
  payments: 'Conecta Stripe a mi tienda Sellbase y prueba la conexión.',
  email: 'Conecta Resend a mi tienda Sellbase para enviar los correos de pedidos.',
  catalog: 'Crea en Sellbase un producto activo con foto, precio y stock.',
  store: 'Configura el correo de contacto de mi tienda Sellbase.',
  webhooks: 'Configura el webhook de Stripe para mi tienda Sellbase y haz una compra de prueba.',
  schema: 'Actualiza Sellbase en mi proyecto con `sellbase upgrade`.',
};

export function HomePage() {
  const { sellbase, t } = useAdmin();
  const doctor = useQuery({
    queryKey: ['sellbase-admin', 'doctor'],
    queryFn: () => sellbase.admin.doctor(),
  });
  const top = useSlot('home.top');
  const bottom = useSlot('home.bottom');
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <>
      <PageTitle>{t.home.title}</PageTitle>
      <div className="sb:flex sb:flex-col sb:gap-6">
        {top}
        <Metrics />
        <Card
          title={t.home.checklist}
          actions={doctor.data?.ok && <Badge tone="green">{t.home.allGood}</Badge>}
        >
          {doctor.isLoading && <Spinner label={t.common.loading} />}
          <ErrorAlert error={doctor.error} />
          <ul className="sb:divide-y sb:divide-zinc-100">
            {doctor.data?.checks.map((check) => (
              <li key={check.id} className="sb:flex sb:flex-col sb:gap-1 sb:py-3">
                <div className="sb:flex sb:items-center sb:gap-2">
                  <span aria-hidden>
                    {check.status === 'ok' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}
                  </span>
                  <span className="sb:font-medium">{t.home.checks[check.id] ?? check.label}</span>
                  <span className="sb:text-sm sb:text-zinc-500">{check.message}</span>
                </div>
                {check.status !== 'ok' && (
                  <div className="sb:ml-7 sb:flex sb:flex-wrap sb:items-center sb:gap-2 sb:text-sm">
                    {check.hint && <span className="sb:text-zinc-600">{check.hint}</span>}
                    {PROMPTS[check.id] && (
                      <Button
                        variant="outline"
                        className="sb:px-2 sb:py-1 sb:text-xs"
                        onClick={() => {
                          void navigator.clipboard?.writeText(PROMPTS[check.id] ?? '');
                          setCopied(check.id);
                        }}
                      >
                        {copied === check.id ? t.home.copied : `${t.home.askAi} · ${t.home.copy}`}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {bottom}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  to,
  testId,
}: {
  label: string;
  value: string;
  detail?: string;
  to?: string;
  testId?: string;
}) {
  const body = (
    <div
      className="sb:flex sb:h-full sb:flex-col sb:gap-1 sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:bg-white sb:p-4"
      data-testid={testId}
    >
      <span className="sb:text-xs sb:font-medium sb:uppercase sb:tracking-wide sb:text-zinc-500">
        {label}
      </span>
      <span className="sb:text-2xl sb:font-semibold">{value}</span>
      {detail && <span className="sb:text-xs sb:text-zinc-500">{detail}</span>}
    </div>
  );
  return to ? (
    <Link to={to} className="sb:block sb:hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
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
  if (report.isLoading) return <Spinner label={t.common.loading} />;
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
    <div className="sb:flex sb:flex-col sb:gap-4">
      <div className="sb:grid sb:grid-cols-2 sb:gap-3 sb:lg:grid-cols-5">
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
        <Stat
          label={t.home.toFulfill}
          value={String(r.orders_to_fulfill)}
          to="/orders"
          testId="metric-to-fulfill"
        />
        <Stat label={t.home.bookingsToday} value={String(r.bookings_today)} to="/agenda" />
      </div>
      <div className="sb:grid sb:gap-4 sb:lg:grid-cols-[2fr_1fr]">
        <Card title={t.home.salesChart}>
          <div
            className="sb:flex sb:h-32 sb:items-end sb:gap-[2px]"
            role="img"
            aria-label={t.home.salesChart}
          >
            {r.daily.map((d) => (
              <div
                key={d.date}
                title={`${dayLabel(d.date)}: ${money(d.amount)} · ${t.home.ordersCount(d.orders)}`}
                className="sb:flex-1 sb:rounded-t-sm sb:bg-[var(--sba-primary)] sb:opacity-80 sb:hover:opacity-100"
                style={{ height: `${Math.max(d.amount ? 4 : 1, (d.amount / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="sb:mt-1 sb:flex sb:justify-between sb:text-xs sb:text-zinc-500">
            <span>{dayLabel(r.daily[0]?.date ?? '')}</span>
            <span>{dayLabel(r.daily.at(-1)?.date ?? '')}</span>
          </div>
        </Card>
        <Card title={t.home.topProducts}>
          {r.top_products.length === 0 ? (
            <p className="sb:text-sm sb:text-zinc-500">{t.home.noSales}</p>
          ) : (
            <ol className="sb:flex sb:flex-col sb:gap-2 sb:text-sm">
              {r.top_products.map((p) => (
                <li
                  key={`${p.product_id}-${p.title}`}
                  className="sb:flex sb:justify-between sb:gap-2"
                >
                  <span className="sb:truncate">
                    {p.product_id ? (
                      <Link to={`/products/${p.product_id}`} className="sb:hover:underline">
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                    <span className="sb:block sb:text-xs sb:text-zinc-500">
                      {t.home.units(p.quantity)}
                    </span>
                  </span>
                  <span className="sb:font-medium">{money(p.amount)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
