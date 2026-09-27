import { formatMoney, toDecimalString, toMinorUnits, type Sellbase } from '@sellbase/sdk';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { Alert, Button, Card, ErrorAlert, Field, Input, Textarea } from '../ui.js';

type Order = Awaited<ReturnType<Sellbase['admin']['orders']['get']>>;
type Panel = null | 'fulfill' | 'refund' | 'cancel';

/**
 * Order actions (SPEC §11): fulfill, refund, cancel, note, resend. Money actions show the
 * impact and ask for an explicit confirmation before calling the API.
 */
export function OrderActions({ order }: { order: Order }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirming, setConfirming] = useState(false);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const refundable = order.amount_paid - order.amount_refunded;
  const [amount, setAmount] = useState(toDecimalString(refundable, order.currency));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [refundToo, setRefundToo] = useState(refundable > 0);
  const [note, setNote] = useState('');
  const money = (n: number) => formatMoney(n, order.currency);

  const done = (next: Order) => {
    qc.setQueryData(['sellbase-admin', 'order', order.id], next);
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'orders'] });
    setPanel(null);
    setConfirming(false);
    setReason('');
  };
  const fulfill = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.fulfill(order.id, {
        ...(carrier ? { carrier } : {}),
        ...(tracking ? { tracking_number: tracking } : {}),
        ...(trackingUrl ? { tracking_url: trackingUrl } : {}),
        notify_customer: notify,
      }),
    onSuccess: done,
  });
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
    onSuccess: done,
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
    onSuccess: done,
  });
  const addNote = useMutation({
    mutationFn: () => sellbase.admin.orders.note(order.id, note),
    onSuccess: (o) => {
      setNote('');
      done(o);
    },
  });
  const resend = useMutation({ mutationFn: () => sellbase.admin.orders.notify(order.id) });

  const canShip =
    order.status === 'open' &&
    order.items.some((i) => i.fulfillment_type === 'shipment' && i.fulfilled_quantity < i.quantity);
  const canCancel = order.status === 'open' || order.status === 'pending_payment';
  const refundAmount = (() => {
    try {
      return toMinorUnits(amount || '0', order.currency);
    } catch {
      return 0;
    }
  })();
  const open = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setConfirming(false);
  };
  const notifyBox = (
    <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
      <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
      {t.orders.notifyCustomer}
    </label>
  );

  return (
    <Card title={t.orders.actions}>
      <div className="sb:flex sb:flex-col sb:gap-3">
        <div className="sb:flex sb:flex-wrap sb:gap-2">
          {canShip && (
            <Button
              variant={panel === 'fulfill' ? 'primary' : 'outline'}
              onClick={() => open('fulfill')}
            >
              {t.orders.fulfill}
            </Button>
          )}
          {refundable > 0 && (
            <Button
              variant={panel === 'refund' ? 'primary' : 'outline'}
              onClick={() => open('refund')}
            >
              {t.orders.refund}
            </Button>
          )}
          {canCancel && (
            <Button
              variant={panel === 'cancel' ? 'danger' : 'outline'}
              onClick={() => open('cancel')}
            >
              {t.orders.cancelOrder}
            </Button>
          )}
        </div>

        {panel === 'fulfill' && (
          <div className="sb:flex sb:flex-col sb:gap-3">
            <Field label={t.orders.carrier}>
              <Input
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="Estafeta, DHL…"
              />
            </Field>
            <Field label={t.orders.trackingNumber}>
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </Field>
            <Field label={t.orders.trackingUrl}>
              <Input
                type="url"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                placeholder="https://"
              />
            </Field>
            {notifyBox}
            <Button onClick={() => fulfill.mutate()} disabled={fulfill.isPending}>
              {t.orders.fulfill}
            </Button>
            <ErrorAlert error={fulfill.error} />
          </div>
        )}

        {panel === 'refund' && (
          <div className="sb:flex sb:flex-col sb:gap-3">
            <p className="sb:text-sm sb:text-zinc-500">{t.orders.refundable(money(refundable))}</p>
            <Field label={`${t.orders.refundAmount} (${order.currency})`}>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label={t.orders.reason}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {notifyBox}
            {!confirming ? (
              <Button
                onClick={() => setConfirming(true)}
                disabled={!reason || refundAmount <= 0 || refundAmount > refundable}
              >
                {t.orders.refund}
              </Button>
            ) : (
              <>
                <Alert tone="amber">
                  {t.orders.refundImpact(money(refundAmount), order.email)}
                </Alert>
                <div className="sb:flex sb:gap-2">
                  <Button
                    variant="danger"
                    onClick={() => refund.mutate()}
                    disabled={refund.isPending}
                  >
                    {t.orders.confirm}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t.orders.back2}
                  </Button>
                </div>
              </>
            )}
            <ErrorAlert error={refund.error} />
          </div>
        )}

        {panel === 'cancel' && (
          <div className="sb:flex sb:flex-col sb:gap-3">
            <Field label={t.orders.reason}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
              />
              {t.orders.restock}
            </label>
            {refundable > 0 && (
              <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
                <input
                  type="checkbox"
                  checked={refundToo}
                  onChange={(e) => setRefundToo(e.target.checked)}
                />
                {t.orders.refundToo} ({money(refundable)})
              </label>
            )}
            {notifyBox}
            {!confirming ? (
              <Button variant="danger" onClick={() => setConfirming(true)} disabled={!reason}>
                {t.orders.cancelOrder}
              </Button>
            ) : (
              <>
                <Alert tone="amber">
                  {t.orders.cancelImpact(refundToo && refundable > 0 ? money(refundable) : null)}
                </Alert>
                <div className="sb:flex sb:gap-2">
                  <Button
                    variant="danger"
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                  >
                    {t.orders.confirm}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {t.orders.back2}
                  </Button>
                </div>
              </>
            )}
            <ErrorAlert error={cancel.error} />
          </div>
        )}

        <div className="sb:flex sb:flex-col sb:gap-2 sb:border-t sb:border-zinc-100 sb:pt-3">
          <Textarea
            aria-label={t.orders.addNote}
            placeholder={t.orders.addNote}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="sb:min-h-16"
          />
          <div className="sb:flex sb:flex-wrap sb:gap-2">
            <Button
              variant="outline"
              onClick={() => addNote.mutate()}
              disabled={!note.trim() || addNote.isPending}
            >
              {t.orders.addNote}
            </Button>
            <Button variant="ghost" onClick={() => resend.mutate()} disabled={resend.isPending}>
              {resend.isSuccess ? t.orders.resent : t.orders.resend}
            </Button>
          </div>
          <ErrorAlert error={addNote.error ?? resend.error} />
        </div>
      </div>
    </Card>
  );
}
