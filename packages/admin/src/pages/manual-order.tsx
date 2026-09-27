import { formatMoney, toDecimalString, toMinorUnits } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { PageTitle } from '../shell.js';
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Textarea } from '../ui.js';

interface Line {
  variant_id: string;
  title: string;
  currency: string;
  quantity: number;
  price: string;
  catalogPrice: number;
}

type Method = 'cash' | 'spei' | 'card' | 'other';

/** Manual order: a sale made outside the storefront (POST /orders, ADR 0009). */
export function ManualOrderPage() {
  const { sellbase, t } = useAdmin();
  const m = t.orders.manual;
  const qc = useQueryClient();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const currency = store.data?.default_currency ?? 'MXN';
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'admin' | 'whatsapp'>('admin');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState('');
  const [shipping, setShipping] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'paid' | 'link'>('paid');
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const products = useQuery({
    queryKey: ['sellbase-admin', 'products', 'manual-order', q],
    queryFn: () =>
      sellbase.admin.products.search({ status: 'active', limit: 8, ...(q ? { q } : {}) }),
    enabled: q.length > 0,
  });

  const toAmount = (value: string) => {
    try {
      return toMinorUnits(value || '0', currency);
    } catch {
      return 0;
    }
  };
  const subtotal = lines.reduce((sum, l) => sum + toAmount(l.price) * l.quantity, 0);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const create = useMutation({
    mutationFn: () =>
      sellbase.admin.orders.create({
        email,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(phone ? { phone } : {}),
        channel,
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          ...(toAmount(l.price) !== l.catalogPrice ? { unit_price_amount: toAmount(l.price) } : {}),
        })),
        ...(code ? { discount_codes: [code.trim().toUpperCase()] } : {}),
        shipping_amount: toAmount(shipping),
        ...(note ? { note } : {}),
        payment:
          mode === 'paid'
            ? { mode: 'paid', method, ...(reference ? { reference } : {}) }
            : { mode: 'link' },
        notify_customer: notify,
        ...(mode === 'paid' ? { confirm: true } : {}),
      }),
    onSuccess: () => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['sellbase-admin'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'paid' && !confirming) setConfirming(true);
    else create.mutate();
  };

  if (create.data) {
    const { order, payment_url } = create.data;
    return (
      <>
        <PageTitle>{m.title}</PageTitle>
        <Card>
          <div className="sb:flex sb:flex-col sb:gap-4" data-testid="manual-order-done">
            <Alert tone="green">
              {m.created(order.number)} {formatMoney(order.total_amount, order.currency)}
            </Alert>
            {payment_url && (
              <div className="sb:flex sb:flex-col sb:gap-2 sb:text-sm">
                <span>{m.linkReady}</span>
                <Input readOnly value={payment_url} onFocus={(e) => e.target.select()} />
              </div>
            )}
            <div className="sb:flex sb:gap-2">
              <Link
                to={`/orders/${order.id}`}
                className="sb:rounded-[var(--sba-radius)] sb:bg-[var(--sba-primary)] sb:px-4 sb:py-2 sb:text-sm sb:font-medium sb:text-[var(--sba-primary-fg)]"
              >
                {m.view}
              </Link>
              <Button
                variant="ghost"
                onClick={() => {
                  create.reset();
                  setLines([]);
                  setEmail('');
                  setFirstName('');
                  setLastName('');
                  setPhone('');
                  setCode('');
                  setShipping('');
                  setNote('');
                  setReference('');
                }}
              >
                {m.another}
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <Link to="/orders" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.orders.back}
      </Link>
      <PageTitle>{m.title}</PageTitle>
      <p className="sb:-mt-4 sb:mb-6 sb:text-sm sb:text-zinc-500">{m.intro}</p>
      <form onSubmit={submit} className="sb:flex sb:flex-col sb:gap-6" aria-label={m.title}>
        <Card title={m.customer}>
          <div className="sb:grid sb:gap-4 sb:md:grid-cols-2">
            <Field label={m.email}>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={m.phone}>
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={m.firstName}>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </Field>
            <Field label={m.lastName}>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </Field>
            <Field label={t.orders.channel}>
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                <option value="admin">{t.orders.channels.admin}</option>
                <option value="whatsapp">{t.orders.channels.whatsapp}</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title={m.products}>
          <div className="sb:relative sb:mb-4">
            <Input
              type="search"
              aria-label={m.searchProducts}
              placeholder={m.searchProducts}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {q && products.data && (
              <ul className="sb:mt-2 sb:divide-y sb:divide-zinc-100 sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:text-sm">
                {products.data.data.flatMap((p) =>
                  p.type === 'service'
                    ? []
                    : p.variants
                        .filter((v) => v.status === 'active')
                        .map((v) => {
                          const title = v.title === 'Default' ? p.title : `${p.title} · ${v.title}`;
                          const stock = v.inventory
                            ? v.inventory.on_hand - v.inventory.reserved
                            : null;
                          return (
                            <li
                              key={v.id}
                              className="sb:flex sb:items-center sb:justify-between sb:gap-2 sb:px-3 sb:py-2"
                            >
                              <span>
                                {title}
                                <span className="sb:block sb:text-xs sb:text-zinc-500">
                                  {formatMoney(v.price_amount, v.currency)}
                                  {stock !== null ? ` · stock ${stock}` : ''}
                                </span>
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                className="sb:px-3 sb:py-1"
                                aria-label={`${m.add} ${title}`}
                                onClick={() => {
                                  const existing = lines.findIndex((l) => l.variant_id === v.id);
                                  if (existing >= 0)
                                    setLine(existing, {
                                      quantity: (lines[existing]?.quantity ?? 0) + 1,
                                    });
                                  else
                                    setLines([
                                      ...lines,
                                      {
                                        variant_id: v.id,
                                        title,
                                        currency: v.currency,
                                        quantity: 1,
                                        price: toDecimalString(v.price_amount, v.currency),
                                        catalogPrice: v.price_amount,
                                      },
                                    ]);
                                  setSearch('');
                                }}
                              >
                                {m.add}
                              </Button>
                            </li>
                          );
                        }),
                )}
              </ul>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="sb:text-sm sb:text-zinc-500">{m.noItems}</p>
          ) : (
            <ul className="sb:flex sb:flex-col sb:gap-3">
              {lines.map((l, i) => (
                <li
                  key={l.variant_id}
                  className="sb:grid sb:grid-cols-[1fr_6rem_8rem_auto] sb:items-end sb:gap-3 sb:text-sm"
                  data-testid="manual-order-line"
                >
                  <span className="sb:pb-2 sb:font-medium">{l.title}</span>
                  <Field label={m.qty}>
                    <Input
                      type="number"
                      min={1}
                      max={999}
                      value={l.quantity}
                      onChange={(e) =>
                        setLine(i, { quantity: Math.max(1, Number(e.target.value) || 1) })
                      }
                    />
                  </Field>
                  <Field label={m.unitPrice}>
                    <Input
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) => setLine(i, { price: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    className="sb:mb-0.5"
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    {m.remove}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="sb:mt-4 sb:grid sb:gap-4 sb:md:grid-cols-2">
            <Field label={m.discountCode}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="sb:font-mono"
              />
            </Field>
            <Field label={`${m.shipping} (${currency})`}>
              <Input
                inputMode="decimal"
                value={shipping}
                onChange={(e) => setShipping(e.target.value)}
              />
            </Field>
          </div>
          <p className="sb:mt-4 sb:flex sb:justify-between sb:text-sm">
            <span className="sb:text-zinc-500">{m.estimateHint}</span>
            <span className="sb:font-semibold" data-testid="manual-order-subtotal">
              {m.estimated}: {formatMoney(subtotal, currency)}
            </span>
          </p>
        </Card>

        <Card title={m.payment}>
          <div className="sb:flex sb:flex-col sb:gap-4">
            <div
              className="sb:flex sb:flex-wrap sb:gap-4 sb:text-sm"
              role="radiogroup"
              aria-label={m.payment}
            >
              <label className="sb:flex sb:items-center sb:gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'paid'}
                  onChange={() => setMode('paid')}
                />
                {m.paid}
              </label>
              <label className="sb:flex sb:items-center sb:gap-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'link'}
                  onChange={() => {
                    setMode('link');
                    setConfirming(false);
                  }}
                />
                {m.link}
              </label>
            </div>
            {mode === 'paid' && (
              <div className="sb:grid sb:gap-4 sb:md:grid-cols-2">
                <Field label={m.method}>
                  <Select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                    {(['cash', 'spei', 'card', 'other'] as const).map((k) => (
                      <option key={k} value={k}>
                        {m.methods[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={`${m.reference} (${t.discounts.optional})`}>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label={`${m.note} (${t.discounts.optional})`}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              {m.notify}
            </label>
          </div>
        </Card>

        <ErrorAlert error={create.error} />
        {confirming && mode === 'paid' && (
          <Alert tone="amber">
            {m.confirmPaid(formatMoney(subtotal, currency), m.methods[method] ?? method)}
          </Alert>
        )}
        <div className="sb:flex sb:gap-2">
          <Button type="submit" disabled={!email || lines.length === 0 || create.isPending}>
            {confirming ? m.confirm : m.create}
          </Button>
          {confirming && (
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {m.back}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
