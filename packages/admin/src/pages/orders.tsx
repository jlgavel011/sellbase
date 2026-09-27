import { formatMoney } from '@sellbase/sdk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { OrderActions } from './order-actions.js';
import { PageTitle, useSlot } from '../shell.js';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Input,
  Select,
  Spinner,
  Table,
  td,
  type Tone,
} from '../ui.js';

const TONES: Record<string, Tone> = {
  paid: 'green',
  completed: 'green',
  fulfilled: 'green',
  open: 'blue',
  unfulfilled: 'amber',
  partially_fulfilled: 'amber',
  partially_paid: 'amber',
  pending_payment: 'amber',
  unpaid: 'amber',
  cancelled: 'red',
  refunded: 'red',
  partially_refunded: 'amber',
};

export function StatusBadge({ value }: { value: string }) {
  const { t } = useAdmin();
  return (
    <Badge tone={TONES[value] ?? 'neutral'}>
      {(t.status as Record<string, string>)[value] ?? value}
    </Badge>
  );
}

function useDate() {
  const { config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  return (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function OrdersPage() {
  const { sellbase, t } = useAdmin();
  const date = useDate();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [fulfillment, setFulfillment] = useState('');
  const [channel, setChannel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const filters = {
    ...(q ? { q } : {}),
    ...(status ? { status: status as 'open' } : {}),
    ...(fulfillment ? { fulfillment_status: fulfillment as 'unfulfilled' } : {}),
    ...(channel ? { channel: channel as 'web' } : {}),
    // Dates are local days: from 00:00 to the end of the "to" day.
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to
      ? { to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() }
      : {}),
  };
  const filtered = Object.keys(filters).length > 0;
  const orders = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'orders', filters],
    queryFn: ({ pageParam }) =>
      sellbase.admin.orders.search({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = orders.data?.pages.flatMap((p) => p.data) ?? [];
  const top = useSlot('orders.list.top');
  const clear = () => {
    setSearch('');
    setStatus('');
    setFulfillment('');
    setChannel('');
    setFrom('');
    setTo('');
  };

  return (
    <>
      <PageTitle
        actions={
          <Link
            to="/orders/new"
            className="sb:rounded-[var(--sba-radius)] sb:bg-[var(--sba-primary)] sb:px-4 sb:py-2 sb:text-sm sb:font-medium sb:text-[var(--sba-primary-fg)]"
          >
            {t.orders.new}
          </Link>
        }
      >
        {t.orders.title}
      </PageTitle>
      {top}
      <div
        className="sb:mb-4 sb:grid sb:gap-2 sb:sm:grid-cols-2 sb:lg:grid-cols-4"
        role="search"
        aria-label={t.orders.filters.label}
      >
        <div className="sb:lg:col-span-2">
          <Input
            type="search"
            aria-label={t.orders.filters.search}
            placeholder={t.orders.filters.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label={t.orders.status}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t.orders.filters.allStatuses}</option>
          {(['pending_payment', 'open', 'completed', 'cancelled'] as const).map((v) => (
            <option key={v} value={v}>
              {t.status[v]}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t.status.unfulfilled}
          value={fulfillment}
          onChange={(e) => setFulfillment(e.target.value)}
        >
          <option value="">{t.orders.filters.allFulfillment}</option>
          {(['unfulfilled', 'partially_fulfilled', 'fulfilled'] as const).map((v) => (
            <option key={v} value={v}>
              {t.status[v]}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t.orders.channel}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">{t.orders.filters.allChannels}</option>
          {Object.entries(t.orders.channels).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          aria-label={t.orders.filters.from}
          title={t.orders.filters.from}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="date"
          aria-label={t.orders.filters.to}
          title={t.orders.filters.to}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <Card>
        {orders.isLoading && <Spinner label={t.common.loading} />}
        <ErrorAlert error={orders.error} />
        {orders.data && rows.length === 0 && !filtered && (
          <EmptyState
            title={t.orders.empty}
            prompt={t.orders.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        )}
        {orders.data && rows.length === 0 && filtered && (
          <div className="sb:flex sb:items-center sb:gap-3 sb:text-sm sb:text-zinc-500">
            —
            <Button variant="ghost" onClick={clear}>
              {t.orders.filters.clear}
            </Button>
          </div>
        )}
        {rows.length > 0 && (
          <Table
            head={[
              t.orders.number,
              t.orders.customer,
              t.orders.date,
              t.orders.status,
              t.orders.total,
            ]}
          >
            {rows.map((o) => (
              <tr key={o.id} className="sb:hover:bg-zinc-50" data-testid="order-row">
                <td className={td}>
                  <Link
                    to={`/orders/${o.id}`}
                    className="sb:font-medium sb:text-[var(--sba-primary)] sb:underline-offset-2 sb:hover:underline"
                  >
                    #{o.number}
                  </Link>
                  {o.channel !== 'web' && (
                    <span className="sb:block sb:text-xs sb:text-zinc-500">
                      {t.orders.channels[o.channel] ?? o.channel}
                    </span>
                  )}
                </td>
                <td className={td}>{o.email}</td>
                <td className={`${td} sb:whitespace-nowrap sb:text-zinc-500`}>
                  {date(o.placed_at)}
                </td>
                <td className={`${td} sb:space-x-1`}>
                  {o.status === 'pending_payment' || o.status === 'cancelled' ? (
                    <StatusBadge value={o.status} />
                  ) : (
                    <>
                      <StatusBadge value={o.payment_status} />
                      <StatusBadge value={o.fulfillment_status} />
                    </>
                  )}
                </td>
                <td className={`${td} sb:text-right sb:font-medium`}>
                  {formatMoney(o.total_amount, o.currency)}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {orders.hasNextPage && (
          <div className="sb:mt-4">
            <Button
              variant="outline"
              onClick={() => void orders.fetchNextPage()}
              disabled={orders.isFetchingNextPage}
            >
              {t.customers.loadMore}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

export function OrderDetailPage({ id }: { id: string }) {
  const { sellbase, t } = useAdmin();
  const date = useDate();
  const order = useQuery({
    queryKey: ['sellbase-admin', 'order', id],
    queryFn: () => sellbase.admin.orders.get(id),
  });
  const sidebar = useSlot('order.detail.sidebar', { orderId: id });

  if (order.isLoading) return <Spinner label={t.common.loading} />;
  if (order.error || !order.data) return <ErrorAlert error={order.error} />;
  const o = order.data;
  const ev = t.orders.events;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  /** Timeline text in the admin's language; the API message is the fallback. */
  const eventText = (e: (typeof o.events)[number]) => {
    const d = e.data;
    switch (e.type) {
      case 'order.created': {
        const payment = d.payment as { mode?: string; method?: string } | undefined;
        if (!payment) return ev['order.created'];
        return payment.mode === 'paid'
          ? ev.manualPaid(t.orders.manual.methods[payment.method ?? ''] ?? payment.method ?? '')
          : ev.manualLink;
      }
      case 'digital.granted':
        return ev['digital.granted'](num(d.count) || (Array.isArray(d.files) ? d.files.length : 0));
      case 'test_purchase':
        return ev.test_purchase;
      case 'fulfillment.created':
        return ev['fulfillment.created'](num(d.quantity), str(d.carrier), str(d.tracking_number));
      case 'refund.created':
        return ev['refund.created'](formatMoney(num(d.amount), o.currency), str(d.reason) ?? '');
      case 'order.cancelled':
        return ev['order.cancelled'](str(d.reason) ?? '');
      case 'notification.requested':
        return ev['notification.requested'];
      case 'inventory.oversold':
        return ev['inventory.oversold'](num(d.short_by));
      case 'notification.sent':
        return ev.emailSent(ev.templates[str(d.template) ?? ''] ?? str(d.template) ?? '');
      default:
        return e.message;
    }
  };
  const money = (n: number) => formatMoney(n, o.currency);
  const address = o.shipping_address;

  return (
    <>
      <Link to="/orders" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.orders.back}
      </Link>
      <PageTitle
        actions={
          <div className="sb:space-x-1">
            <StatusBadge value={o.status} />
            <StatusBadge value={o.payment_status} />
            <StatusBadge value={o.fulfillment_status} />
          </div>
        }
      >
        {t.orders.number} #{o.number}
      </PageTitle>
      <div className="sb:grid sb:gap-6 sb:lg:grid-cols-[1fr_18rem]">
        <div className="sb:flex sb:flex-col sb:gap-6">
          <Card title={t.orders.items}>
            <ul className="sb:divide-y sb:divide-zinc-100 sb:text-sm">
              {o.items.map((i) => (
                <li key={i.id} className="sb:flex sb:justify-between sb:gap-3 sb:py-2">
                  <span>
                    {i.title}
                    {i.variant_title ? ` — ${i.variant_title}` : ''} × {i.quantity}
                    {i.sku && <span className="sb:ml-2 sb:text-xs sb:text-zinc-400">{i.sku}</span>}
                  </span>
                  <span>{money(i.total_amount)}</span>
                </li>
              ))}
            </ul>
            <dl className="sb:mt-3 sb:flex sb:flex-col sb:gap-1 sb:border-t sb:border-zinc-100 sb:pt-3 sb:text-sm">
              <div className="sb:flex sb:justify-between">
                <dt>{t.orders.subtotal}</dt>
                <dd>{money(o.subtotal_amount)}</dd>
              </div>
              {o.discount_amount > 0 && (
                <div className="sb:flex sb:justify-between">
                  <dt>{t.orders.discount}</dt>
                  <dd>−{money(o.discount_amount)}</dd>
                </div>
              )}
              {o.shipping_amount > 0 && (
                <div className="sb:flex sb:justify-between">
                  <dt>{t.orders.shipping}</dt>
                  <dd>{money(o.shipping_amount)}</dd>
                </div>
              )}
              <div className="sb:flex sb:justify-between sb:font-semibold">
                <dt>{t.orders.total}</dt>
                <dd>{money(o.total_amount)}</dd>
              </div>
            </dl>
          </Card>
          <Card title={t.orders.timeline}>
            <ol className="sb:flex sb:flex-col sb:gap-3 sb:text-sm">
              {o.events.map((e, i) => (
                <li key={i} className="sb:flex sb:gap-3">
                  <span className="sb:w-44 sb:shrink-0 sb:text-zinc-500">{date(e.created_at)}</span>
                  <span>{eventText(e)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="sb:flex sb:flex-col sb:gap-6">
          <Card title={t.orders.customer}>
            <p className="sb:text-sm">{o.email}</p>
            {address && (
              <div className="sb:mt-3 sb:text-sm sb:text-zinc-600">
                <p className="sb:mb-1 sb:font-medium sb:text-zinc-700">
                  {t.orders.shippingAddress}
                </p>
                <p>{[address.first_name, address.last_name].filter(Boolean).join(' ')}</p>
                <p>
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}
                </p>
                <p>
                  {[address.postal_code, address.city, address.state].filter(Boolean).join(', ')} ·{' '}
                  {address.country}
                </p>
              </div>
            )}
          </Card>
          <OrderActions order={o} />
          {o.fulfillments.some((f) => f.shipment) && (
            <Card title={t.orders.shipments}>
              <ul className="sb:flex sb:flex-col sb:gap-2 sb:text-sm">
                {o.fulfillments
                  .filter((f) => f.shipment)
                  .map((f) => (
                    <li key={f.id}>
                      {[f.shipment?.carrier, f.shipment?.tracking_number]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                      {f.shipment?.tracking_url && (
                        <a
                          href={f.shipment.tracking_url}
                          target="_blank"
                          rel="noreferrer"
                          className="sb:ml-2 sb:text-[var(--sba-primary)] sb:underline"
                        >
                          {t.orders.track}
                        </a>
                      )}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
          {o.refunds.length > 0 && (
            <Card title={t.orders.refunds}>
              <ul className="sb:flex sb:flex-col sb:gap-2 sb:text-sm">
                {o.refunds.map((r) => (
                  <li key={r.id} className="sb:flex sb:justify-between sb:gap-2">
                    <span>{r.reason}</span>
                    <span>−{money(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title={t.orders.payments}>
            <ul className="sb:flex sb:flex-col sb:gap-2 sb:text-sm">
              {o.payments.map((p) => (
                <li key={p.id} className="sb:flex sb:justify-between">
                  <span>
                    {p.provider} · {p.method}
                  </span>
                  <span>{formatMoney(p.amount, p.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {sidebar}
        </div>
      </div>
    </>
  );
}
