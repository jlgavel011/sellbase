import { formatMoney, toDecimalString, toMinorUnits, type Sellbase } from '@sellbase/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import type { Texts } from '../texts.js';
import {
  Banner,
  Button,
  Checkbox,
  CopyButton,
  ErrorAlert,
  Field,
  Input,
  InputGroup,
  Menu,
  Modal,
  Textarea,
  useToast,
} from '../ui.js';

export type Order = Awaited<ReturnType<Sellbase['admin']['orders']['get']>>;

function useOrderUpdate(order: Order) {
  const qc = useQueryClient();
  return (next: Order) => {
    qc.setQueryData(['sellbase-admin', 'order', order.id], next);
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'orders'] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'report-summary'] });
  };
}

/**
 * Order actions (SPEC §11): fulfill, refund, cancel, comment, resend, packing slip. Money
 * actions show the impact and ask for an explicit confirmation before calling the API.
 */
export function OrderActions({ order, panel }: { order: Order; panel: 'fulfill' | 'payment' }) {
  return panel === 'fulfill' ? <FulfillAction order={order} /> : <BalanceLink order={order} />;
}

function FulfillAction({ order }: { order: Order }) {
  const { sellbase, t } = useAdmin();
  const toast = useToast();
  const update = useOrderUpdate(order);
  const [open, setOpen] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const fulfill = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.fulfill(order.id, {
        ...(carrier ? { carrier } : {}),
        ...(tracking ? { tracking_number: tracking } : {}),
        ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
        notify_customer: notify,
      }),
    onSuccess: (next) => {
      update(next);
      setOpen(false);
      toast(t.orderView.fulfilledToast);
    },
  });
  if (order.status !== 'open') return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t.orders.fulfill}</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t.orders.fulfill}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => fulfill.mutate()} loading={fulfill.isPending}>
              {t.orders.fulfill}
            </Button>
          </>
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          <div className="sb:grid sb:gap-3 sb:sm:grid-cols-2">
            <Field label={t.orders.carrier}>
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Estafeta, DHL, FedEx…"
              />
            </Field>
            <Field label={t.orders.trackingNumber}>
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </Field>
          </div>
          <Field label={t.orders.trackingUrl}>
            <Input
              type="url"
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>
          <Checkbox
            label={t.orders.notifyCustomer}
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <ErrorAlert error={fulfill.error} />
        </div>
      </Modal>
    </>
  );
}

function BalanceLink({ order }: { order: Order }) {
  const { sellbase, t } = useAdmin();
  const paymentLink = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.paymentLink(order.id, {
        success_url: window.location.origin,
        cancel_url: window.location.origin,
      }),
  });
  if (order.payment_status !== 'partially_paid' || order.status !== 'open') return null;
  const money = (n: number) => formatMoney(n, order.currency);
  return (
    <div className="sb:mt-3 sb:flex sb:flex-col sb:items-end sb:gap-2">
      <Button
        variant="secondary"
        icon="link"
        onClick={() => paymentLink.mutate()}
        loading={paymentLink.isPending}
      >
        {t.orders.balanceLink} ({money(order.total_amount - order.amount_paid)})
      </Button>
      {paymentLink.data && (
        <div className="sb:flex sb:w-full sb:flex-col sb:gap-1">
          <span>{t.orders.balanceReady}</span>
          <div className="sb:flex sb:gap-2">
            <Input readOnly value={paymentLink.data.url} aria-label={t.orders.balanceLink} />
            <CopyButton
              value={paymentLink.data.url}
              label={t.orders.copy}
              copiedLabel={t.orders.copied}
            />
          </div>
        </div>
      )}
      <ErrorAlert error={paymentLink.error} />
    </div>
  );
}

/** Header buttons: refund, print packing slip, and more actions (cancel, resend). */
export function OrderHeaderActions({
  order,
  storeName,
  logo,
}: {
  order: Order;
  storeName: string;
  logo: string | null;
}) {
  const { sellbase, t } = useAdmin();
  const toast = useToast();
  const update = useOrderUpdate(order);
  const [modal, setModal] = useState<null | 'refund' | 'cancel'>(null);
  const [confirming, setConfirming] = useState(false);
  const refundable = order.amount_paid - order.amount_refunded;
  const [amount, setAmount] = useState(toDecimalString(refundable, order.currency));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [refundToo, setRefundToo] = useState(refundable > 0);
  const [notify, setNotify] = useState(true);
  const money = (n: number) => formatMoney(n, order.currency);
  const close = () => {
    setModal(null);
    setConfirming(false);
  };
  const done = (message: string) => (next: Order) => {
    update(next);
    close();
    setReason('');
    toast(message);
  };
  const refund = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.refund(
        order.id,
        {
          amount: toMinorUnits(amount || '0', order.currency),
          reason,
          notify_customer: notify,
          confirm: true,
        },
        crypto.randomUUID(),
      ),
    onSuccess: done(t.orderView.refundedToast),
  });
  const cancel = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.cancel(order.id, {
        reason,
        restock,
        refund: refundToo && refundable > 0,
        notify_customer: notify,
        confirm: true,
      }),
    onSuccess: done(t.orderView.cancelledToast),
  });
  const resend = useMutation({
    mutationFn: () => sellbase.admin.orders.notify(order.id),
    onSuccess: () => toast(t.orderView.resentToast),
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const refundAmount = (() => {
    try {
      return toMinorUnits(amount || '0', order.currency);
    } catch {
      return 0;
    }
  })();
  const canCancel = order.status === 'open' || order.status === 'pending_payment';

  return (
    <>
      {refundable > 0 && (
        <Button variant="secondary" onClick={() => setModal('refund')}>
          {t.orders.refund}
        </Button>
      )}
      <Button
        variant="secondary"
        icon="printer"
        onClick={() => printPackingSlip(order, storeName, logo, t)}
      >
        {t.orderView.slip.print}
      </Button>
      <Menu
        label={t.orderView.more}
        items={[
          { label: t.orders.resend, icon: 'mail', onClick: () => resend.mutate() },
          canCancel && {
            label: t.orders.cancelOrder,
            icon: 'x',
            destructive: true,
            onClick: () => setModal('cancel'),
          },
        ]}
      />

      <Modal
        open={modal === 'refund'}
        onClose={close}
        title={t.orders.refund}
        footer={
          confirming ? (
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t.orders.back2}
              </Button>
              <Button variant="critical" onClick={() => refund.mutate()} loading={refund.isPending}>
                {t.orders.confirm}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setConfirming(true)}
              disabled={!reason || refundAmount <= 0 || refundAmount > refundable}
            >
              {t.orders.refund}
            </Button>
          )
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          <p className="sb:text-[var(--sba-text-subdued)]">
            {t.orders.refundable(money(refundable))}
          </p>
          <Field label={`${t.orders.refundAmount} (${order.currency})`}>
            <InputGroup
              prefix="$"
              inputMode="decimal"
              aria-label={`${t.orders.refundAmount} (${order.currency})`}
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setConfirming(false);
              }}
            />
          </Field>
          <Field label={t.orders.reason}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Checkbox
            label={t.orders.notifyCustomer}
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          {confirming && (
            <Banner tone="warning">
              {t.orders.refundImpact(money(refundAmount), order.email)}
            </Banner>
          )}
          <ErrorAlert error={refund.error} />
        </div>
      </Modal>

      <Modal
        open={modal === 'cancel'}
        onClose={close}
        title={t.orders.cancelOrder}
        footer={
          confirming ? (
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t.orders.back2}
              </Button>
              <Button variant="critical" onClick={() => cancel.mutate()} loading={cancel.isPending}>
                {t.orders.confirm}
              </Button>
            </>
          ) : (
            <Button variant="critical" onClick={() => setConfirming(true)} disabled={!reason}>
              {t.orders.cancelOrder}
            </Button>
          )
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          <Field label={t.orders.reason}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Checkbox
            label={t.orders.restock}
            checked={restock}
            onChange={(e) => setRestock(e.target.checked)}
          />
          {refundable > 0 && (
            <Checkbox
              label={`${t.orders.refundToo} (${money(refundable)})`}
              checked={refundToo}
              onChange={(e) => setRefundToo(e.target.checked)}
            />
          )}
          <Checkbox
            label={t.orders.notifyCustomer}
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          {confirming && (
            <Banner tone="warning">
              {t.orders.cancelImpact(refundToo && refundable > 0 ? money(refundable) : null)}
            </Banner>
          )}
          <ErrorAlert error={cancel.error} />
        </div>
      </Modal>
    </>
  );
}

/** Comment box at the top of the timeline (saved as an internal note). */
export function OrderComment({ order }: { order: Order }) {
  const { sellbase, t } = useAdmin();
  const toast = useToast();
  const update = useOrderUpdate(order);
  const [note, setNote] = useState('');
  const add = useMutation({
    mutationFn: () => sellbase.admin.orders.note(order.id, note.trim()),
    onSuccess: (next) => {
      update(next);
      setNote('');
      toast(t.orderView.commentPosted);
    },
  });
  return (
    <form
      className="sb:flex sb:flex-col sb:gap-2 sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)] sb:p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) add.mutate();
      }}
    >
      <Textarea
        aria-label={t.orders.addNote}
        placeholder={t.orderView.comment}
        value={note}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        className="sb:min-h-0 sb:border-0 sb:bg-transparent sb:shadow-none sb:focus:shadow-none"
      />
      <div className="sb:flex sb:justify-end">
        <Button type="submit" size="sm" disabled={!note.trim()} loading={add.isPending}>
          {t.orderView.post}
        </Button>
      </div>
      <ErrorAlert error={add.error} />
    </form>
  );
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** Opens a printable packing slip (no prices) in a new window. */
export function printPackingSlip(order: Order, storeName: string, logo: string | null, t: Texts) {
  const s = t.orderView.slip;
  const a = order.shipping_address;
  const address = a
    ? [
        [a.first_name, a.last_name].filter(Boolean).join(' '),
        [a.line1, a.line2].filter(Boolean).join(', '),
        [a.postal_code, a.city, a.state].filter(Boolean).join(', '),
        a.country,
        a.phone ?? '',
      ]
        .filter(Boolean)
        .map(esc)
        .join('<br>')
    : esc(t.orderView.noShippingAddress);
  const items = order.items
    .map(
      (i) =>
        `<tr><td>${esc(i.title)}${i.variant_title && i.variant_title !== 'Default' ? `<br><small>${esc(i.variant_title)}</small>` : ''}${i.sku ? `<br><small>SKU ${esc(i.sku)}</small>` : ''}</td><td class="qty">${i.quantity}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(s.order(order.number))}</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; color: #1a1a1a; margin: 40px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; }
  header img { max-height: 48px; max-width: 200px; }
  h1 { font-size: 20px; margin: 0; }
  .cols { display: flex; gap: 48px; margin: 24px 0; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #616161; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; text-transform: uppercase; color: #616161; border-bottom: 1px solid #ccc; padding: 8px 0; }
  td { border-bottom: 1px solid #e3e3e3; padding: 10px 0; vertical-align: top; }
  small { color: #616161; }
  .qty { text-align: right; width: 80px; }
  footer { margin-top: 32px; text-align: center; color: #616161; }
</style></head><body>
<header><div>${logo ? `<img src="${esc(logo)}" alt="">` : `<h1>${esc(storeName)}</h1>`}</div>
<div style="text-align:right"><h1>${esc(s.order(order.number))}</h1><div>${esc(new Date(order.placed_at).toLocaleDateString())}</div></div></header>
<div class="cols"><div><h2>${esc(s.shipTo)}</h2>${address}</div><div><h2>${esc(s.billTo)}</h2>${esc(order.email)}${order.phone ? `<br>${esc(order.phone)}` : ''}</div></div>
<table><thead><tr><th>${esc(s.items)}</th><th class="qty">${esc(s.qty)}</th></tr></thead><tbody>${items}</tbody></table>
${order.notes ? `<p><strong>${esc(t.orderView.notes)}:</strong> ${esc(order.notes)}</p>` : ''}
<footer>${esc(s.thanks)}<br>${esc(storeName)}</footer>
<script>window.onload = () => { window.print(); };</script>
</body></html>`;
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
