import { formatMoney } from '@sellbase/sdk';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { PageTitle, useSlot } from '../shell.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorAlert,
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
  partially_refunded: 'red',
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
  const [status, setStatus] = useState('');
  const orders = useQuery({
    queryKey: ['sellbase-admin', 'orders', status],
    queryFn: () =>
      sellbase.admin.orders.search(status ? { fulfillment_status: status as 'unfulfilled' } : {}),
  });
  const top = useSlot('orders.list.top');

  return (
    <>
      <PageTitle
        actions={
          <div className="sb:w-52">
            <Select
              aria-label={t.orders.status}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t.orders.all}</option>
              <option value="unfulfilled">{t.status.unfulfilled}</option>
              <option value="partially_fulfilled">{t.status.partially_fulfilled}</option>
              <option value="fulfilled">{t.status.fulfilled}</option>
            </Select>
          </div>
        }
      >
        {t.orders.title}
      </PageTitle>
      {top}
      <Card>
        {orders.isLoading && <Spinner label={t.common.loading} />}
        <ErrorAlert error={orders.error} />
        {orders.data && orders.data.data.length === 0 && (
          <EmptyState
            title={t.orders.empty}
            prompt={t.orders.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        )}
        {orders.data && orders.data.data.length > 0 && (
          <Table
            head={[
              t.orders.number,
              t.orders.customer,
              t.orders.date,
              t.orders.status,
              t.orders.total,
            ]}
          >
            {orders.data.data.map((o) => (
              <tr key={o.id} className="sb:hover:bg-zinc-50">
                <td className={td}>
                  <Link
                    to={`/orders/${o.id}`}
                    className="sb:font-medium sb:text-[var(--sba-primary)] sb:underline-offset-2 sb:hover:underline"
                  >
                    #{o.number}
                  </Link>
                </td>
                <td className={td}>{o.email}</td>
                <td className={`${td} sb:whitespace-nowrap sb:text-zinc-500`}>
                  {date(o.placed_at)}
                </td>
                <td className={`${td} sb:space-x-1`}>
                  <StatusBadge value={o.payment_status} />
                  <StatusBadge value={o.fulfillment_status} />
                </td>
                <td className={`${td} sb:text-right sb:font-medium`}>
                  {formatMoney(o.total_amount, o.currency)}
                </td>
              </tr>
            ))}
          </Table>
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
                  <span className="sb:w-36 sb:shrink-0 sb:text-zinc-500">{date(e.created_at)}</span>
                  <span>{e.message}</span>
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
