import { formatMoney } from '@sellbase/sdk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Icon } from '../icons.js';
import { Link, useRouter } from '../router.js';
import { Layout, Page, useStore } from '../shell.js';
import {
  Badge,
  Button,
  Card,
  CardSection,
  CopyButton,
  EmptyState,
  ErrorAlert,
  Input,
  PageSkeleton,
  Table,
  td,
} from '../ui.js';
import { StatusBadge } from './orders.js';
import { TableSkeleton } from './products.js';

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

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

function Avatar({ name }: { name: string }) {
  return (
    <span className="sb:grid sb:h-8 sb:w-8 sb:shrink-0 sb:place-items-center sb:rounded-full sb:bg-emerald-100 sb:text-xs sb:font-bold sb:text-emerald-800">
      {initials(name) || '?'}
    </span>
  );
}

export function CustomersPage() {
  const { sellbase, t } = useAdmin();
  const { navigate } = useRouter();
  const f = useFormat();
  const store = useStore();
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
    <Page title={t.customers.title} width="wide">
      {customers.data && rows.length === 0 && !q ? (
        <Card>
          <EmptyState
            icon="customers"
            title={t.customers.empty}
            prompt={t.customers.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="sb:border-b sb:border-[var(--sba-border)] sb:p-2">
            <Input
              type="search"
              aria-label={t.customers.search}
              placeholder={t.customers.search}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          {customers.isLoading && <TableSkeleton />}
          <ErrorAlert error={customers.error} />
          {customers.data && rows.length === 0 && q && (
            <p className="sb:px-4 sb:py-10 sb:text-center sb:text-[var(--sba-text-subdued)]">
              {t.shell.noResults}
            </p>
          )}
          {rows.length > 0 && (
            <Table
              head={[
                t.customers.name,
                t.customers.orders,
                t.customers.spent,
                t.customers.lastOrder,
              ]}
            >
              {rows.map((c) => (
                <tr
                  key={c.id}
                  data-testid="customer-row"
                  className="sb:cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a')) return;
                    navigate(`/customers/${c.id}`);
                  }}
                >
                  <td className={td}>
                    <span className="sb:flex sb:items-center sb:gap-3">
                      <Avatar name={fullName(c) || c.email} />
                      <span className="sb:min-w-0">
                        <Link
                          to={`/customers/${c.id}`}
                          className="sb:font-semibold sb:text-[var(--sba-text-strong)] sb:hover:underline"
                        >
                          {fullName(c) || c.email}
                        </Link>
                        {fullName(c) && (
                          <span className="sb:block sb:truncate sb:text-xs sb:text-[var(--sba-text-subdued)]">
                            {c.email}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className={td}>{c.orders_count}</td>
                  <td className={`${td} sb:font-medium`}>
                    {f.money(c.total_spent_amount, currency)}
                  </td>
                  <td className={`${td} sb:text-[var(--sba-text-subdued)]`}>
                    {c.last_order_at ? f.date(c.last_order_at) : '—'}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {customers.hasNextPage && (
            <div className="sb:border-t sb:border-[var(--sba-border)] sb:p-3 sb:text-center">
              <Button
                variant="secondary"
                onClick={() => void customers.fetchNextPage()}
                loading={customers.isFetchingNextPage}
              >
                {t.customers.loadMore}
              </Button>
            </div>
          )}
        </Card>
      )}
    </Page>
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
  if (customer.isLoading) return <PageSkeleton />;
  if (customer.error || !c) return <ErrorAlert error={customer.error} />;
  const name = fullName(c) || c.email;

  return (
    <Page
      title={name}
      backTo="/customers"
      backLabel={t.customers.title}
      subtitle={`${t.customers.since} ${f.date(c.created_at)}`}
      badges={c.accepts_marketing ? <Badge tone="green">{t.customers.marketing}</Badge> : undefined}
    >
      <Layout
        aside={
          <>
            <Card title={t.orderView.contact}>
              <div className="sb:flex sb:flex-col sb:gap-2">
                <span className="sb:flex sb:items-center sb:gap-2 sb:break-all">
                  <Icon
                    name="mail"
                    className="sb:h-4 sb:w-4 sb:shrink-0 sb:text-[var(--sba-text-subdued)]"
                  />
                  <a
                    href={`mailto:${c.email}`}
                    className="sb:text-[var(--sba-link)] sb:hover:underline"
                  >
                    {c.email}
                  </a>
                </span>
                {c.phone && <span className="sb:pl-6">{c.phone}</span>}
                <div>
                  <CopyButton
                    variant="tertiary"
                    value={c.email}
                    label={t.orders.copy}
                    copiedLabel={t.orders.copied}
                  />
                </div>
              </div>
              <CardSection title={t.customers.addresses}>
                {c.addresses.length === 0 ? (
                  <p className="sb:text-[var(--sba-text-subdued)]">{t.customers.noAddresses}</p>
                ) : (
                  <ul className="sb:flex sb:flex-col sb:gap-3">
                    {c.addresses.map((a) => (
                      <li key={a.id} className="sb:leading-relaxed">
                        {a.line1}
                        {a.line2 ? `, ${a.line2}` : ''}
                        <br />
                        {a.postal_code} {a.city}
                        {a.state ? `, ${a.state}` : ''}
                        <br />
                        {a.country}
                      </li>
                    ))}
                  </ul>
                )}
              </CardSection>
            </Card>
          </>
        }
      >
        <div className="sba-card sb:grid sb:divide-y sb:divide-[var(--sba-border)] sb:sm:grid-cols-3 sb:sm:divide-x sb:sm:divide-y-0">
          <div className="sb:flex sb:flex-col sb:gap-1 sb:p-4">
            <span className="sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
              {t.customers.spent}
            </span>
            <span
              className="sb:text-xl sb:font-bold sb:text-[var(--sba-text-strong)]"
              data-testid="customer-spent"
            >
              {f.money(c.total_spent_amount, c.currency)}
            </span>
          </div>
          <div className="sb:flex sb:flex-col sb:gap-1 sb:p-4">
            <span className="sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
              {t.customers.orders}
            </span>
            <span className="sb:text-xl sb:font-bold sb:text-[var(--sba-text-strong)]">
              {c.orders_count}
            </span>
          </div>
          <div className="sb:flex sb:flex-col sb:gap-1 sb:p-4">
            <span className="sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
              {t.customers.since}
            </span>
            <span className="sb:text-xl sb:font-bold sb:text-[var(--sba-text-strong)]">
              {f.date(c.created_at)}
            </span>
          </div>
        </div>
        <Card title={t.customers.history} padded={false}>
          {c.orders.length === 0 ? (
            <p className="sb:px-4 sb:pb-4 sb:text-[var(--sba-text-subdued)]">
              {t.customers.noOrders}
            </p>
          ) : (
            <Table head={[t.orders.number, t.orders.date, t.orderView.paymentCol, t.orders.total]}>
              {c.orders.map((o) => (
                <tr key={o.id}>
                  <td className={td}>
                    <Link
                      to={`/orders/${o.id}`}
                      className="sb:font-semibold sb:text-[var(--sba-text-strong)] sb:hover:underline"
                    >
                      #{o.number}
                    </Link>
                  </td>
                  <td className={`${td} sb:text-[var(--sba-text-subdued)]`}>
                    {f.date(o.placed_at)}
                  </td>
                  <td className={`${td} sb:space-x-1`}>
                    <StatusBadge
                      value={o.status === 'cancelled' ? 'cancelled' : o.payment_status}
                    />
                    <StatusBadge value={o.fulfillment_status} />
                  </td>
                  <td className={td}>{f.money(o.total_amount, o.currency)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title={t.customers.bookings}>
          {c.bookings.length === 0 ? (
            <p className="sb:text-[var(--sba-text-subdued)]">{t.customers.noBookings}</p>
          ) : (
            <ul className="sb:flex sb:flex-col sb:divide-y sb:divide-[var(--sba-border)]">
              {c.bookings.map((b) => (
                <li
                  key={b.id}
                  className="sb:flex sb:items-center sb:justify-between sb:gap-3 sb:py-2"
                >
                  <span className="sb:flex sb:items-center sb:gap-3">
                    <Icon
                      name="calendar"
                      className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]"
                    />
                    <span>
                      <span className="sb:font-medium">{b.product?.title ?? '—'}</span> ·{' '}
                      {b.resource.name}
                      <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">
                        {new Intl.DateTimeFormat(f.locale, {
                          timeZone: b.timezone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(b.starts_at))}
                      </span>
                    </span>
                  </span>
                  <Badge>{t.agenda.statuses[b.status] ?? b.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Layout>
    </Page>
  );
}
