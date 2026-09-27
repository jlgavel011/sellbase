import { formatMoney } from '@sellbase/sdk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { PageTitle } from '../shell.js';
import { Badge, Button, Card, EmptyState, ErrorAlert, Input, Spinner, Table, td } from '../ui.js';
import { StatusBadge } from './orders.js';

function useFormat() {
  const { config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  return {
    locale,
    date: (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' }),
    money: (n: number, currency: string) => formatMoney(n, currency, locale),
  };
}

const fullName = (c: { first_name: string | null; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ');

export function CustomersPage() {
  const { sellbase, t } = useAdmin();
  const f = useFormat();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);
  const customers = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'customers', q],
    queryFn: ({ pageParam }) =>
      sellbase.admin.customers.search({
        ...(q ? { q } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = customers.data?.pages.flatMap((p) => p.data) ?? [];
  const currency = store.data?.default_currency ?? 'MXN';

  return (
    <>
      <PageTitle>{t.customers.title}</PageTitle>
      <div className="sb:mb-4 sb:max-w-sm">
        <Input
          type="search"
          aria-label={t.customers.search}
          placeholder={t.customers.search}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      <Card>
        {customers.isLoading && <Spinner label={t.common.loading} />}
        <ErrorAlert error={customers.error} />
        {customers.data && rows.length === 0 && !q && (
          <EmptyState
            title={t.customers.empty}
            prompt={t.customers.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        )}
        {customers.data && rows.length === 0 && q && (
          <p className="sb:text-sm sb:text-zinc-500">—</p>
        )}
        {rows.length > 0 && (
          <Table
            head={[t.customers.name, t.customers.orders, t.customers.spent, t.customers.lastOrder]}
          >
            {rows.map((c) => (
              <tr key={c.id} className="sb:hover:bg-zinc-50" data-testid="customer-row">
                <td className={td}>
                  <Link
                    to={`/customers/${c.id}`}
                    className="sb:font-medium sb:text-[var(--sba-primary)] sb:hover:underline"
                  >
                    {fullName(c) || c.email}
                  </Link>
                  {fullName(c) && (
                    <span className="sb:block sb:text-xs sb:text-zinc-500">{c.email}</span>
                  )}
                </td>
                <td className={td}>{c.orders_count}</td>
                <td className={`${td} sb:font-medium`}>
                  {f.money(c.total_spent_amount, currency)}
                </td>
                <td className={`${td} sb:text-zinc-500`}>
                  {c.last_order_at ? f.date(c.last_order_at) : '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {customers.hasNextPage && (
          <div className="sb:mt-4">
            <Button
              variant="outline"
              onClick={() => void customers.fetchNextPage()}
              disabled={customers.isFetchingNextPage}
            >
              {t.customers.loadMore}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

export function CustomerDetailPage({ id }: { id: string }) {
  const { sellbase, t } = useAdmin();
  const f = useFormat();
  const customer = useQuery({
    queryKey: ['sellbase-admin', 'customer', id],
    queryFn: () => sellbase.admin.customers.get(id),
  });
  const c = customer.data;

  return (
    <>
      <Link to="/customers" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.customers.back}
      </Link>
      {customer.isLoading && <Spinner label={t.common.loading} />}
      <ErrorAlert error={customer.error} />
      {c && (
        <>
          <PageTitle>{fullName(c) || c.email}</PageTitle>
          <div className="sb:grid sb:gap-6 sb:md:grid-cols-[1fr_2fr]">
            <div className="sb:flex sb:flex-col sb:gap-6">
              <Card>
                <dl className="sb:flex sb:flex-col sb:gap-3 sb:text-sm">
                  <div>
                    <dt className="sb:text-zinc-500">{t.customers.spent}</dt>
                    <dd className="sb:text-xl sb:font-semibold" data-testid="customer-spent">
                      {f.money(c.total_spent_amount, c.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="sb:text-zinc-500">{t.customers.orders}</dt>
                    <dd>{c.orders_count}</dd>
                  </div>
                  <div>
                    <dt className="sb:text-zinc-500">Email</dt>
                    <dd>{c.email}</dd>
                  </div>
                  {c.phone && (
                    <div>
                      <dt className="sb:text-zinc-500">Tel.</dt>
                      <dd>{c.phone}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="sb:text-zinc-500">{t.customers.since}</dt>
                    <dd>{f.date(c.created_at)}</dd>
                  </div>
                  {c.accepts_marketing && (
                    <div>
                      <Badge tone="green">{t.customers.marketing}</Badge>
                    </div>
                  )}
                </dl>
              </Card>
              <Card title={t.customers.addresses}>
                {c.addresses.length === 0 ? (
                  <p className="sb:text-sm sb:text-zinc-500">{t.customers.noAddresses}</p>
                ) : (
                  <ul className="sb:flex sb:flex-col sb:gap-3 sb:text-sm">
                    {c.addresses.map((a) => (
                      <li key={a.id}>
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ''}
                        <br />
                        {a.postal_code} {a.city}
                        {a.state ? `, ${a.state}` : ''}, {a.country}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <div className="sb:flex sb:flex-col sb:gap-6">
              <Card title={t.customers.history}>
                {c.orders.length === 0 ? (
                  <p className="sb:text-sm sb:text-zinc-500">{t.customers.noOrders}</p>
                ) : (
                  <Table head={[t.orders.number, t.orders.date, t.orders.status, t.orders.total]}>
                    {c.orders.map((o) => (
                      <tr key={o.id}>
                        <td className={td}>
                          <Link
                            to={`/orders/${o.id}`}
                            className="sb:font-medium sb:text-[var(--sba-primary)] sb:hover:underline"
                          >
                            #{o.number}
                          </Link>
                        </td>
                        <td className={`${td} sb:text-zinc-500`}>{f.date(o.placed_at)}</td>
                        <td className={`${td} sb:space-x-1`}>
                          <StatusBadge
                            value={o.status === 'cancelled' ? 'cancelled' : o.payment_status}
                          />
                          <StatusBadge value={o.fulfillment_status} />
                        </td>
                        <td className={`${td} sb:text-right`}>
                          {f.money(o.total_amount, o.currency)}
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>
              <Card title={t.customers.bookings}>
                {c.bookings.length === 0 ? (
                  <p className="sb:text-sm sb:text-zinc-500">{t.customers.noBookings}</p>
                ) : (
                  <ul className="sb:divide-y sb:divide-zinc-100 sb:text-sm">
                    {c.bookings.map((b) => (
                      <li key={b.id} className="sb:flex sb:items-center sb:justify-between sb:py-2">
                        <span>
                          {b.product?.title ?? '—'} · {b.resource.name}
                          <span className="sb:block sb:text-xs sb:text-zinc-500">
                            {new Intl.DateTimeFormat(f.locale, {
                              timeZone: b.timezone,
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }).format(new Date(b.starts_at))}
                          </span>
                        </span>
                        <Badge>{t.agenda.statuses[b.status] ?? b.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
