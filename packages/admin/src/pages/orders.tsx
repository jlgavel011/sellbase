import { formatMoney } from '@sellbase/sdk';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Icon } from '../icons.js';
import { Link, useRouter } from '../router.js';
import { Layout, Page, useSlot, useStore } from '../shell.js';
import {
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  ErrorAlert,
  Input,
  PageSkeleton,
  Select,
  Table,
  Tabs,
  Thumbnail,
  buttonClass,
  td,
  type Tone,
} from '../ui.js';
import { OrderActions, OrderHeaderActions, OrderComment, type Order } from './order-actions.js';
import { TableSkeleton } from './products.js';

const TONES: Record<string, Tone> = {
  paid: 'neutral',
  completed: 'neutral',
  fulfilled: 'neutral',
  open: 'blue',
  unfulfilled: 'yellow',
  partially_fulfilled: 'amber',
  partially_paid: 'amber',
  pending_payment: 'amber',
  unpaid: 'amber',
  cancelled: 'neutral',
  refunded: 'neutral',
  partially_refunded: 'neutral',
};
const DONE = new Set(['paid', 'fulfilled', 'completed', 'refunded', 'partially_refunded']);

export function StatusBadge({ value }: { value: string }) {
  const { t } = useAdmin();
  return (
    <Badge tone={TONES[value] ?? 'neutral'} dot={DONE.has(value) ? 'full' : 'empty'}>
      {(t.status as Record<string, string>)[value] ?? value}
    </Badge>
  );
}

export function useDate() {
  const { config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  return (iso: string, style: 'short' | 'medium' = 'medium') =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: style === 'short' ? 'short' : 'medium',
      timeStyle: 'short',
    });
}

type OrderTab = 'all' | 'unfulfilled' | 'unpaid' | 'open' | 'closed';
const TAB_FILTERS: Record<OrderTab, Record<string, string>> = {
  all: {},
  unfulfilled: { status: 'open', fulfillment_status: 'unfulfilled' },
  unpaid: { status: 'pending_payment' },
  open: { status: 'open' },
  closed: { status: 'completed' },
};

export function OrdersPage() {
  const { sellbase, t, config } = useAdmin();
  const { navigate } = useRouter();
  const date = useDate();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const [tab, setTab] = useState<OrderTab>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [fulfillment, setFulfillment] = useState('');
  const [channel, setChannel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [more, setMore] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim().replace(/^#/, '')), 300);
    return () => clearTimeout(id);
  }, [search]);
  const filters = {
    ...TAB_FILTERS[tab],
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(fulfillment ? { fulfillment_status: fulfillment } : {}),
    ...(channel ? { channel } : {}),
    // Dates are local days: from 00:00 to the end of the "to" day.
    ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
    ...(to
      ? { to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() }
      : {}),
  } as Parameters<typeof sellbase.admin.orders.search>[0];
  const filtered = Object.keys(filters ?? {}).length > 0;
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
    setTab('all');
    setSearch('');
    setStatus('');
    setFulfillment('');
    setChannel('');
    setFrom('');
    setTo('');
  };

  return (
    <Page
      title={t.orders.title}
      width="wide"
      actions={
        <Link to="/orders/new" className={buttonClass('primary')}>
          {t.orders.new}
        </Link>
      }
    >
      {top}
      {orders.data && rows.length === 0 && !filtered ? (
        <Card>
          <EmptyState
            icon="orders"
            title={t.orders.empty}
            prompt={t.orders.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
            action={
              <Button variant="secondary" onClick={() => navigate('/orders/new')}>
                {t.orders.new}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="sb:border-b sb:border-[var(--sba-border)]">
            <Tabs
              label={t.orders.title}
              value={tab}
              onChange={setTab}
              tabs={(Object.keys(TAB_FILTERS) as OrderTab[]).map((id) => ({
                id,
                label: t.orderView.tabs[id],
              }))}
            />
          </div>
          <div
            className="sb:flex sb:flex-col sb:gap-2 sb:border-b sb:border-[var(--sba-border)] sb:p-2"
            role="search"
            aria-label={t.orders.filters.label}
          >
            <div className="sb:flex sb:flex-wrap sb:gap-2">
              <div className="sb:min-w-48 sb:flex-1">
                <Input
                  type="search"
                  aria-label={t.orders.filters.search}
                  placeholder={t.orders.filters.search}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                aria-label={t.orders.channel}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="sb:w-auto"
              >
                <option value="">{t.orders.filters.allChannels}</option>
                {Object.entries(t.orders.channels).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                icon="filter"
                onClick={() => setMore(!more)}
                aria-expanded={more}
              >
                {t.orderView.moreFilters}
              </Button>
              {filtered && (
                <Button variant="tertiary" onClick={clear}>
                  {t.orders.filters.clear}
                </Button>
              )}
            </div>
            {more && (
              <div className="sb:grid sb:gap-2 sb:sm:grid-cols-4">
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
                  aria-label={t.orderView.unfulfilled}
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
            )}
          </div>
          {orders.isLoading && <TableSkeleton />}
          <ErrorAlert error={orders.error} />
          {orders.data && rows.length === 0 && (
            <div className="sb:flex sb:flex-col sb:items-center sb:gap-2 sb:px-4 sb:py-10 sb:text-[var(--sba-text-subdued)]">
              {t.orderView.noOrders}
            </div>
          )}
          {rows.length > 0 && (
            <Table
              head={[
                t.orders.number,
                t.orders.date,
                t.orders.customer,
                t.orders.channel,
                t.orders.total,
                t.orderView.paymentCol,
                t.orderView.fulfillmentCol,
              ]}
            >
              {rows.map((o) => (
                <tr
                  key={o.id}
                  data-testid="order-row"
                  className="sb:cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a')) return;
                    navigate(`/orders/${o.id}`);
                  }}
                >
                  <td className={td}>
                    <Link
                      to={`/orders/${o.id}`}
                      className="sb:font-semibold sb:text-[var(--sba-text-strong)] sb:hover:underline"
                    >
                      #{o.number}
                    </Link>
                  </td>
                  <td className={`${td} sb:whitespace-nowrap sb:text-[var(--sba-text-subdued)]`}>
                    {date(o.placed_at, 'short')}
                  </td>
                  <td className={td}>{o.email}</td>
                  <td className={`${td} sb:text-[var(--sba-text-subdued)]`}>
                    {t.orders.channels[o.channel] ?? o.channel}
                  </td>
                  <td className={`${td} sb:whitespace-nowrap`}>
                    {formatMoney(o.total_amount, o.currency, locale)}
                  </td>
                  <td className={td}>
                    {o.status === 'cancelled' ? (
                      <StatusBadge value="cancelled" />
                    ) : o.status === 'pending_payment' ? (
                      <StatusBadge value="pending_payment" />
                    ) : (
                      <StatusBadge value={o.payment_status} />
                    )}
                  </td>
                  <td className={td}>
                    {o.status === 'cancelled' || o.status === 'pending_payment' ? null : (
                      <StatusBadge value={o.fulfillment_status} />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {orders.hasNextPage && (
            <div className="sb:border-t sb:border-[var(--sba-border)] sb:p-3 sb:text-center">
              <Button
                variant="secondary"
                onClick={() => void orders.fetchNextPage()}
                loading={orders.isFetchingNextPage}
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

export function OrderDetailPage({ id }: { id: string }) {
  const { sellbase, t, config } = useAdmin();
  const date = useDate();
  const store = useStore();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const order = useQuery({
    queryKey: ['sellbase-admin', 'order', id],
    queryFn: () => sellbase.admin.orders.get(id),
  });
  const sidebar = useSlot('order.detail.sidebar', { orderId: id });

  if (order.isLoading) return <PageSkeleton />;
  if (order.error || !order.data) return <ErrorAlert error={order.error} />;
  const o = order.data;
  const money = (n: number) => formatMoney(n, o.currency, locale);
  const address = o.shipping_address;
  const consents = Array.isArray((o.metadata as { consents?: unknown }).consents)
    ? (o.metadata as { consents: { text: string; accepted_at: string }[] }).consents
    : [];
  const units = o.items.reduce((n, i) => n + i.quantity, 0);
  const pendingItems = o.items.filter(
    (i) => i.fulfilled_quantity < i.quantity && i.fulfillment_type === 'shipment',
  );
  const shipments = o.fulfillments.filter((f) => f.shipment);
  const closed = o.status === 'cancelled';

  return (
    <Page
      title={`${t.orders.number} #${o.number}`}
      backTo="/orders"
      backLabel={t.orders.title}
      badges={
        <>
          {o.status === 'cancelled' || o.status === 'pending_payment' ? (
            <StatusBadge value={o.status} />
          ) : (
            <StatusBadge value={o.payment_status} />
          )}
          {!closed && o.status !== 'pending_payment' && (
            <StatusBadge value={o.fulfillment_status} />
          )}
        </>
      }
      subtitle={`${date(o.placed_at)} · ${t.orders.channels[o.channel] ?? o.channel}`}
      actions={
        <OrderHeaderActions
          order={o}
          storeName={store.data?.name ?? ''}
          logo={store.data?.logo_url ?? null}
        />
      }
    >
      <Layout
        aside={
          <>
            <Card title={t.orderView.notes}>
              <p className={o.notes ? '' : 'sb:text-[var(--sba-text-subdued)]'}>
                {o.notes || t.orderView.noNotes}
              </p>
            </Card>
            <Card title={t.orders.customer}>
              <div className="sb:flex sb:flex-col sb:gap-1">
                {o.customer_id ? (
                  <Link
                    to={`/customers/${o.customer_id}`}
                    className="sb:w-fit sb:font-medium sb:text-[var(--sba-link)] sb:hover:underline"
                  >
                    {address
                      ? [address.first_name, address.last_name].filter(Boolean).join(' ') || o.email
                      : o.email}
                  </Link>
                ) : (
                  <span>{o.email}</span>
                )}
              </div>
              <CardSection title={t.orderView.contact}>
                <p className="sb:break-all sb:text-[var(--sba-link)]">{o.email}</p>
                {o.phone && <p>{o.phone}</p>}
              </CardSection>
              <CardSection title={t.orders.shippingAddress}>
                {address ? (
                  <address className="sb:not-italic sb:leading-relaxed">
                    {[address.first_name, address.last_name].filter(Boolean).join(' ')}
                    {[address.first_name, address.last_name].some(Boolean) && <br />}
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}
                    <br />
                    {[address.postal_code, address.city, address.state].filter(Boolean).join(', ')}
                    <br />
                    {address.country}
                    {address.phone && (
                      <>
                        <br />
                        {address.phone}
                      </>
                    )}
                  </address>
                ) : (
                  <p className="sb:text-[var(--sba-text-subdued)]">
                    {t.orderView.noShippingAddress}
                  </p>
                )}
              </CardSection>
            </Card>
            {consents.length > 0 && (
              <Card title={t.orderView.consents} testId="order-consents">
                <ul className="sb:flex sb:flex-col sb:gap-2">
                  {consents.map((c) => (
                    <li key={c.text} className="sb:flex sb:gap-2">
                      <Icon
                        name="checkCircle"
                        className="sb:h-4 sb:w-4 sb:shrink-0 sb:text-[var(--sba-brand-strong)]"
                      />
                      <span>
                        {c.text}
                        <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">
                          {date(c.accepted_at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {sidebar}
          </>
        }
      >
        <Card
          title={
            <span className="sb:flex sb:items-center sb:gap-2">
              <StatusBadge value={o.fulfillment_status} />
              <span className="sb:font-normal sb:text-[var(--sba-text-subdued)]">
                {t.orderView.subtotalItems(units)}
              </span>
            </span>
          }
        >
          <ul className="sb:flex sb:flex-col">
            {o.items.map((i) => (
              <li
                key={i.id}
                className="sb:flex sb:items-start sb:gap-3 sb:border-b sb:border-[var(--sba-border)] sb:py-3 first:sb:pt-0 last:sb:border-0 last:sb:pb-0"
              >
                <Thumbnail src={i.image_url} />
                <div className="sb:min-w-0 sb:flex-1">
                  {i.product_id ? (
                    <Link
                      to={`/products/${i.product_id}`}
                      className="sb:font-semibold sb:text-[var(--sba-link)] sb:hover:underline"
                    >
                      {i.title}
                    </Link>
                  ) : (
                    <span className="sb:font-semibold">{i.title}</span>
                  )}
                  {i.variant_title && i.variant_title !== 'Default' && (
                    <span className="sb:mt-0.5 sb:block">
                      <Badge>{i.variant_title}</Badge>
                    </span>
                  )}
                  {i.sku && (
                    <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      SKU: {i.sku}
                    </span>
                  )}
                  {i.fulfillment_type !== 'shipment' && (
                    <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      {i.fulfillment_type === 'digital'
                        ? t.orderView.digital
                        : i.fulfillment_type === 'booking'
                          ? t.orderView.booking
                          : ''}
                    </span>
                  )}
                </div>
                <span className="sb:whitespace-nowrap sb:text-[var(--sba-text-subdued)]">
                  {money(i.unit_price_amount)} × {i.quantity}
                </span>
                <span className="sb:w-24 sb:text-right sb:font-medium">
                  {money(i.total_amount)}
                </span>
              </li>
            ))}
          </ul>
          {shipments.length > 0 && (
            <CardSection>
              <ul className="sb:flex sb:flex-col sb:gap-2">
                {shipments.map((f) => (
                  <li key={f.id} className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
                    <Icon
                      name="truck"
                      className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]"
                    />
                    <span>
                      {[f.shipment?.carrier, f.shipment?.tracking_number]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </span>
                    {f.shipment?.tracking_url && (
                      <a
                        href={f.shipment.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="sb:font-medium sb:text-[var(--sba-link)] sb:hover:underline"
                      >
                        {t.orders.track}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </CardSection>
          )}
          {!closed && pendingItems.length > 0 && (
            <div className="sb:mt-3 sb:flex sb:justify-end">
              <OrderActions order={o} panel="fulfill" />
            </div>
          )}
        </Card>

        <Card
          title={
            <StatusBadge
              value={o.status === 'pending_payment' ? 'pending_payment' : o.payment_status}
            />
          }
        >
          <dl className="sb:flex sb:flex-col sb:gap-1.5">
            <Row
              label={t.orders.subtotal}
              detail={t.orderView.subtotalItems(units)}
              value={money(o.subtotal_amount)}
            />
            {o.discount_amount > 0 && (
              <Row label={t.orders.discount} value={`−${money(o.discount_amount)}`} />
            )}
            {(o.shipping_amount > 0 || pendingItems.length > 0 || shipments.length > 0) && (
              <Row label={t.orders.shipping} value={money(o.shipping_amount)} />
            )}
            {o.tax_amount > 0 && <Row label={t.orderView.taxes} value={money(o.tax_amount)} />}
            <Row label={t.orderView.total} value={money(o.total_amount)} strong />
          </dl>
          <CardSection>
            <dl className="sb:flex sb:flex-col sb:gap-1.5">
              <Row label={t.orderView.paidByCustomer} value={money(o.amount_paid)} />
              {o.refunds.map((r) => (
                <Row
                  key={r.id}
                  label={`${t.orderView.refunded} · ${r.reason}`}
                  value={`−${money(r.amount)}`}
                />
              ))}
              {o.amount_paid < o.total_amount && o.status !== 'cancelled' && (
                <Row
                  label={t.orderView.balance}
                  value={money(o.total_amount - o.amount_paid)}
                  strong
                />
              )}
              {o.amount_refunded > 0 && (
                <Row
                  label={t.orderView.net}
                  value={money(o.amount_paid - o.amount_refunded)}
                  strong
                />
              )}
            </dl>
            {o.payments.length > 0 && (
              <p className="sb:mt-2 sb:text-xs sb:text-[var(--sba-text-subdued)]">
                {o.payments
                  .map(
                    (p) =>
                      `${p.provider} · ${p.method} · ${formatMoney(p.amount, p.currency, locale)}`,
                  )
                  .join(' — ')}
              </p>
            )}
          </CardSection>
          <OrderActions order={o} panel="payment" />
        </Card>

        <Card title={t.orderView.timeline}>
          <OrderComment order={o} />
          <Timeline order={o} />
        </Card>
      </Layout>
    </Page>
  );
}

function Row({
  label,
  value,
  detail,
  strong,
}: {
  label: string;
  value: string;
  detail?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`sb:flex sb:justify-between sb:gap-3 ${strong ? 'sb:font-semibold sb:text-[var(--sba-text-strong)]' : ''}`}
    >
      <dt className="sb:flex sb:gap-6">
        {label}
        {detail && (
          <span className="sb:hidden sb:text-[var(--sba-text-subdued)] sb:sm:inline">{detail}</span>
        )}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function Timeline({ order: o }: { order: Order }) {
  const { t, config } = useAdmin();
  const date = useDate();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
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
        return ev['refund.created'](
          formatMoney(num(d.amount), o.currency, locale),
          str(d.reason) ?? '',
        );
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
  const events = [...o.events].reverse();
  return (
    <ol className="sb:relative sb:mt-4 sb:flex sb:flex-col sb:gap-4 sb:border-l-2 sb:border-[var(--sba-border)] sb:pl-5">
      {events.map((e, i) => (
        <li key={i} className="sb:relative">
          <span
            className={`sb:absolute sb:-left-[1.72rem] sb:top-1 sb:h-3 sb:w-3 sb:rounded-full sb:border-2 sb:border-white ${e.type === 'note' ? 'sb:bg-[#1a1a1a]' : 'sb:bg-[#8a8a8a]'}`}
          />
          <div className="sb:flex sb:flex-wrap sb:justify-between sb:gap-x-4 sb:gap-y-0.5">
            <span
              className={
                e.type === 'note'
                  ? 'sb:rounded-lg sb:bg-[var(--sba-surface-subdued)] sb:px-3 sb:py-2'
                  : ''
              }
            >
              {eventText(e)}
            </span>
            <span className="sb:whitespace-nowrap sb:text-xs sb:text-[var(--sba-text-subdued)]">
              {date(e.created_at)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
