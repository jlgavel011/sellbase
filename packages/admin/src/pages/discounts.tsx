import type { Sellbase } from '@sellbase/sdk';
import { formatMoney, toDecimalString, toMinorUnits } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAdmin } from '../context.js';
import { PageTitle } from '../shell.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Table,
  td,
} from '../ui.js';

type Discount = Awaited<ReturnType<Sellbase['admin']['discounts']['list']>>['data'][number];
type Kind = Discount['kind'];

/** ISO instant → value for <input type="datetime-local"> in browser time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function DiscountsPage() {
  const { sellbase, t, config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const discounts = useQuery({
    queryKey: ['sellbase-admin', 'discounts'],
    queryFn: () => sellbase.admin.discounts.list(),
  });
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const currency = store.data?.default_currency ?? 'MXN';
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const describe = (d: Discount) =>
    d.kind === 'percent'
      ? `${d.value / 100}%`
      : d.kind === 'fixed'
        ? formatMoney(d.value, currency, locale)
        : t.discounts.kinds.free_shipping;

  return (
    <>
      <PageTitle
        actions={
          <Button
            onClick={() => {
              setNotice(null);
              setEditing('new');
            }}
          >
            {t.discounts.new}
          </Button>
        }
      >
        {t.discounts.title}
      </PageTitle>
      <div className="sb:flex sb:flex-col sb:gap-6">
        {notice && <Alert tone="green">{notice}</Alert>}
        {editing && (
          <DiscountForm
            key={editing === 'new' ? 'new' : editing.id}
            discount={editing === 'new' ? null : editing}
            currency={currency}
            onDone={(message) => {
              setEditing(null);
              setNotice(message);
            }}
          />
        )}
        <Card>
          {discounts.isLoading && <Spinner label={t.common.loading} />}
          <ErrorAlert error={discounts.error} />
          {discounts.data?.data.length === 0 && !editing && (
            <EmptyState
              title={t.discounts.empty}
              prompt={t.discounts.emptyPrompt}
              askAi={t.home.askAi}
              copy={t.home.copy}
              copied={t.home.copied}
            />
          )}
          {(discounts.data?.data.length ?? 0) > 0 && (
            <Table head={[t.discounts.code, t.discounts.kind, t.discounts.status, '', '']}>
              {discounts.data?.data.map((d) => (
                <tr key={d.id} data-testid="discount-row">
                  <td className={`${td} sb:font-mono sb:font-medium`}>
                    {d.code ?? <span className="sb:font-sans">{t.discounts.automatic}</span>}
                  </td>
                  <td className={td}>
                    {describe(d)}
                    {d.min_subtotal_amount ? (
                      <span className="sb:block sb:text-xs sb:text-zinc-500">
                        {t.discounts.minSubtotal}:{' '}
                        {formatMoney(d.min_subtotal_amount, currency, locale)}
                      </span>
                    ) : null}
                  </td>
                  <td className={td}>
                    <Badge tone={d.status === 'active' ? 'green' : 'neutral'}>
                      {t.discounts.statuses[d.status] ?? d.status}
                    </Badge>
                  </td>
                  <td className={`${td} sb:text-zinc-500`}>
                    {t.discounts.uses(d.usage_count, d.usage_limit)}
                  </td>
                  <td className={`${td} sb:text-right`}>
                    <Button
                      variant="ghost"
                      className="sb:px-2 sb:py-1"
                      onClick={() => {
                        setNotice(null);
                        setEditing(d);
                      }}
                    >
                      {t.discounts.edit}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function DiscountForm({
  discount,
  currency,
  onDone,
}: {
  discount: Discount | null;
  currency: string;
  onDone: (message: string | null) => void;
}) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const collections = useQuery({
    queryKey: ['sellbase-admin', 'collections'],
    queryFn: () => sellbase.admin.collections.list(),
  });
  const [automatic, setAutomatic] = useState(discount ? discount.code === null : false);
  const [code, setCode] = useState(discount?.code ?? '');
  const [kind, setKind] = useState<Kind>(discount?.kind ?? 'percent');
  const [value, setValue] = useState(() => {
    if (!discount) return '';
    if (discount.kind === 'percent') return String(discount.value / 100);
    if (discount.kind === 'fixed') return toDecimalString(discount.value, currency);
    return '';
  });
  const productScope = discount?.applies_to.type === 'products' ? discount.applies_to : null;
  const [collectionIds, setCollectionIds] = useState<string[]>(
    discount?.applies_to.type === 'collections' ? discount.applies_to.collection_ids : [],
  );
  const [scope, setScope] = useState<'all' | 'collections'>(
    discount?.applies_to.type === 'collections' ? 'collections' : 'all',
  );
  const [minSubtotal, setMinSubtotal] = useState(
    discount?.min_subtotal_amount ? toDecimalString(discount.min_subtotal_amount, currency) : '',
  );
  const [usageLimit, setUsageLimit] = useState(discount?.usage_limit?.toString() ?? '');
  const [perCustomer, setPerCustomer] = useState(discount?.per_customer_limit?.toString() ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(discount?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(discount?.ends_at ?? null));
  const [status, setStatus] = useState<'active' | 'disabled'>(discount?.status ?? 'active');
  const [confirming, setConfirming] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'discounts'] });
  const save = useMutation({
    mutationFn: () => {
      const amount =
        kind === 'percent'
          ? Math.round(Number(value) * 100)
          : kind === 'fixed'
            ? toMinorUnits(value || '0', currency)
            : 0;
      return sellbase.admin.discounts.upsert({
        ...(discount ? { id: discount.id } : {}),
        code: automatic ? null : code.trim().toUpperCase(),
        kind,
        value: amount,
        applies_to: productScope
          ? productScope
          : scope === 'collections' && collectionIds.length
            ? { type: 'collections', collection_ids: collectionIds }
            : { type: 'all' },
        min_subtotal_amount: minSubtotal ? toMinorUnits(minSubtotal, currency) : null,
        usage_limit: usageLimit ? Number(usageLimit) : null,
        per_customer_limit: perCustomer ? Number(perCustomer) : null,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        status,
      });
    },
    onSuccess: () => {
      refresh();
      onDone(t.discounts.saved);
    },
  });
  const remove = useMutation({
    mutationFn: () => sellbase.admin.discounts.delete(discount?.id ?? ''),
    onSuccess: (r) => {
      refresh();
      onDone(r.deleted ? t.discounts.removed : t.discounts.disabledInstead);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Card
      title={discount ? (discount.code ?? t.discounts.automatic) : t.discounts.new}
      actions={
        <Button variant="ghost" onClick={() => onDone(null)}>
          {t.discounts.close}
        </Button>
      }
    >
      <form onSubmit={submit} className="sb:flex sb:flex-col sb:gap-4" aria-label={t.discounts.new}>
        <div className="sb:grid sb:gap-4 sb:md:grid-cols-3">
          <Field label={t.discounts.code}>
            <Input
              value={code}
              disabled={automatic}
              required={!automatic}
              pattern="[A-Za-z0-9_-]{3,40}"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="sb:font-mono"
            />
          </Field>
          <label className="sb:flex sb:items-center sb:gap-2 sb:self-end sb:pb-2 sb:text-sm">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            {t.discounts.automatic}
          </label>
          <Field label={t.discounts.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="active">{t.discounts.statuses.active}</option>
              <option value="disabled">{t.discounts.statuses.disabled}</option>
            </Select>
          </Field>
          <Field label={t.discounts.kind}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {(['percent', 'fixed', 'free_shipping'] as const).map((k) => (
                <option key={k} value={k}>
                  {t.discounts.kinds[k]}
                </option>
              ))}
            </Select>
          </Field>
          {kind !== 'free_shipping' && (
            <Field
              label={
                kind === 'percent' ? t.discounts.percent : `${t.discounts.amount} (${currency})`
              }
            >
              <Input
                required
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          )}
          <Field label={t.discounts.appliesTo}>
            {productScope ? (
              <p className="sb:py-2 sb:text-sm">
                {t.discounts.someProducts(productScope.product_ids.length)}
              </p>
            ) : (
              <Select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                <option value="all">{t.discounts.allProducts}</option>
                {(collections.data?.data.length ?? 0) > 0 && (
                  <option value="collections">{t.discounts.someCollections}</option>
                )}
              </Select>
            )}
          </Field>
        </div>
        {scope === 'collections' && !productScope && (
          <div className="sb:flex sb:flex-wrap sb:gap-3">
            {collections.data?.data.map((c) => (
              <label key={c.id} className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
                <input
                  type="checkbox"
                  checked={collectionIds.includes(c.id)}
                  onChange={(e) =>
                    setCollectionIds(
                      e.target.checked
                        ? [...collectionIds, c.id]
                        : collectionIds.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.title}
              </label>
            ))}
          </div>
        )}
        <div className="sb:grid sb:gap-4 sb:md:grid-cols-3">
          <Field label={`${t.discounts.minSubtotal} (${t.discounts.optional})`}>
            <Input
              inputMode="decimal"
              value={minSubtotal}
              onChange={(e) => setMinSubtotal(e.target.value)}
            />
          </Field>
          <Field label={`${t.discounts.usageLimit} (${t.discounts.optional})`}>
            <Input
              type="number"
              min={1}
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
            />
          </Field>
          <Field label={`${t.discounts.perCustomer} (${t.discounts.optional})`}>
            <Input
              type="number"
              min={1}
              value={perCustomer}
              onChange={(e) => setPerCustomer(e.target.value)}
            />
          </Field>
          <Field label={`${t.discounts.startsAt} (${t.discounts.optional})`}>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field label={`${t.discounts.endsAt} (${t.discounts.optional})`}>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
        </div>
        <ErrorAlert error={save.error ?? remove.error} />
        <div className="sb:flex sb:flex-wrap sb:gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t.discounts.save}
          </Button>
          {discount &&
            (confirming ? (
              <Button
                variant="danger"
                type="button"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {t.discounts.confirmRemove}
              </Button>
            ) : (
              <Button
                variant="ghost"
                type="button"
                className="sb:text-red-700"
                onClick={() => setConfirming(true)}
              >
                {t.discounts.remove}
              </Button>
            ))}
        </div>
      </form>
    </Card>
  );
}
