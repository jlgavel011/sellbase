import { formatMoney, toMinorUnits, type AdminProduct } from '@sellbase/sdk';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link, useRouter } from '../router.js';
import { Page, useSlot } from '../shell.js';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Modal,
  Select,
  Table,
  Tabs,
  Thumbnail,
  buttonClass,
  td,
  useToast,
  type Tone,
} from '../ui.js';

export { ProductFormPage } from './product-editor.js';

type Status = 'draft' | 'active' | 'archived';
type TabId = 'all' | Status;

export const STATUS_TONE: Record<string, Tone> = {
  active: 'green',
  draft: 'blue',
  archived: 'neutral',
};

export function ProductStatusBadge({ status }: { status: string }) {
  const { t } = useAdmin();
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {t.products.statuses[status as Status] ?? status}
    </Badge>
  );
}

/** "12 in stock for 3 variants", "Out of stock" or "not tracked". */
function inventoryText(p: AdminProduct, t: ReturnType<typeof useAdmin>['t']) {
  const live = p.variants.filter((v) => v.status !== 'archived');
  const tracked = live.filter((v) => v.inventory);
  if (p.type === 'service') return { text: '—', tone: 'neutral' as const };
  if (tracked.length === 0) return { text: t.list.untracked, tone: 'neutral' as const };
  const units = tracked.reduce(
    (n, v) => n + (v.inventory ? v.inventory.on_hand - v.inventory.reserved : 0),
    0,
  );
  if (units <= 0) return { text: t.list.outOfStock, tone: 'critical' as const };
  return { text: t.list.inventory(units, live.length), tone: 'neutral' as const };
}

export function ProductsPage() {
  const { sellbase, t, config } = useAdmin();
  const { navigate } = useRouter();
  const toast = useToast();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const filters = {
    ...(q ? { q } : {}),
    ...(tab !== 'all' ? { status: tab } : {}),
    ...(type ? { type: type as 'physical' } : {}),
  };
  const products = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'products', filters],
    queryFn: ({ pageParam }) =>
      sellbase.admin.products.search({
        ...filters,
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = products.data?.pages.flatMap((p) => p.data) ?? [];
  const top = useSlot('products.list.top');
  const visible = rows.map((p) => p.id);
  const allSelected = visible.length > 0 && visible.every((id) => selected.includes(id));
  const someSelected = selected.length > 0 && !allSelected;
  const nothingAtAll = products.data && rows.length === 0 && !q && tab === 'all' && !type;

  const exportCsv = useMutation({
    mutationFn: () => exportProducts(sellbase),
    onSuccess: (csv) => {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'productos.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });

  return (
    <Page
      title={t.products.title}
      width="wide"
      actions={
        <>
          <Button
            variant="secondary"
            icon="download"
            onClick={() => exportCsv.mutate()}
            loading={exportCsv.isPending}
          >
            {t.list.export}
          </Button>
          <Button variant="secondary" icon="upload" onClick={() => setImporting(true)}>
            {t.products.import.button}
          </Button>
          <Link to="/products/new" className={buttonClass('primary')}>
            {t.products.new}
          </Link>
        </>
      }
    >
      {top}
      <ImportPanel open={importing} onClose={() => setImporting(false)} />
      {nothingAtAll ? (
        <Card>
          <EmptyState
            icon="products"
            title={t.products.empty}
            body={t.list.emptyBody}
            action={
              <>
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  {t.products.import.button}
                </Button>
                <Button onClick={() => navigate('/products/new')}>{t.products.new}</Button>
              </>
            }
            prompt={t.products.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-2 sb:border-b sb:border-[var(--sba-border)] sb:pr-2">
            <Tabs
              label={t.products.status}
              value={tab}
              onChange={(v) => {
                setTab(v);
                setSelected([]);
              }}
              tabs={(['all', 'active', 'draft', 'archived'] as const).map((id) => ({
                id,
                label: t.list.tabs[id],
              }))}
            />
            <div className="sb:flex sb:w-full sb:gap-2 sb:px-2 sb:pb-2 sb:sm:w-auto sb:sm:p-0">
              <Input
                type="search"
                placeholder={t.products.search}
                aria-label={t.products.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sb:sm:w-64"
              />
              <Select
                aria-label={t.products.type}
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="sb:w-auto"
              >
                <option value="">{t.list.allTypes}</option>
                {(['physical', 'digital', 'service'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.products.types[k]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {selected.length > 0 && (
            <BulkBar
              ids={selected}
              onDone={(message) => {
                setSelected([]);
                toast(message);
              }}
            />
          )}
          {products.isLoading && <TableSkeleton />}
          <div className="sb:p-2 empty:sb:hidden">
            <ErrorAlert error={products.error} />
          </div>
          {products.data && rows.length === 0 && (
            <p className="sb:px-4 sb:py-10 sb:text-center sb:text-[var(--sba-text-subdued)]">
              {t.list.noResults}
            </p>
          )}
          {rows.length > 0 && (
            <Table
              head={[
                <input
                  key="all"
                  type="checkbox"
                  className="sba-checkbox"
                  aria-label={t.products.bulk.selectAll}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => setSelected(e.target.checked ? visible : [])}
                />,
                '',
                t.products.name,
                t.products.status,
                t.inventoryPage.title,
                t.products.type,
                t.products.price,
              ]}
            >
              {rows.map((p) => {
                const prices = p.variants
                  .filter((v) => v.status === 'active')
                  .map((v) => v.price_amount);
                const currency = p.variants[0]?.currency ?? 'MXN';
                const min = prices.length ? Math.min(...prices) : null;
                const max = prices.length ? Math.max(...prices) : null;
                const inv = inventoryText(p, t);
                const isSelected = selected.includes(p.id);
                return (
                  <tr key={p.id} data-testid="product-row" aria-selected={isSelected}>
                    <td className={`${td} sb:w-8`}>
                      <input
                        type="checkbox"
                        className="sba-checkbox"
                        aria-label={t.products.bulk.select(p.title)}
                        checked={isSelected}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, p.id]
                              : selected.filter((x) => x !== p.id),
                          )
                        }
                      />
                    </td>
                    <td className={`${td} sb:w-12`}>
                      <Thumbnail src={p.media[0]?.url} size="sm" />
                    </td>
                    <td className={td}>
                      <Link
                        to={`/products/${p.id}`}
                        className="sb:font-semibold sb:text-[var(--sba-text-strong)] sb:hover:underline"
                      >
                        {p.title}
                      </Link>
                    </td>
                    <td className={td}>
                      <ProductStatusBadge status={p.status} />
                    </td>
                    <td
                      className={`${td} sb:whitespace-nowrap ${inv.tone === 'critical' ? 'sb:text-[var(--sba-critical)]' : 'sb:text-[var(--sba-text-subdued)]'}`}
                    >
                      {inv.text}
                    </td>
                    <td className={`${td} sb:text-[var(--sba-text-subdued)]`}>
                      {t.products.types[p.type]}
                    </td>
                    <td className={`${td} sb:whitespace-nowrap`}>
                      {min === null
                        ? '—'
                        : min === max
                          ? formatMoney(min, currency, locale)
                          : `${formatMoney(min, currency, locale)} – ${formatMoney(max ?? min, currency, locale)}`}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          {products.hasNextPage && (
            <div className="sb:border-t sb:border-[var(--sba-border)] sb:p-3 sb:text-center">
              <Button
                variant="secondary"
                onClick={() => void products.fetchNextPage()}
                loading={products.isFetchingNextPage}
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

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="sb:flex sb:flex-col sb:gap-3 sb:p-4" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sb:flex sb:items-center sb:gap-3">
          <div className="sba-skeleton sb:h-8 sb:w-8" />
          <div className="sba-skeleton sb:h-3.5 sb:flex-1" />
          <div className="sba-skeleton sb:h-3.5 sb:w-20" />
        </div>
      ))}
    </div>
  );
}

const csvCell = (value: unknown) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every product in the import template format (so it can be edited and imported back). */
async function exportProducts(sellbase: ReturnType<typeof useAdmin>['sellbase']) {
  const all: AdminProduct[] = [];
  let cursor: string | undefined;
  do {
    const page = await sellbase.admin.products.search({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.data);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  const header = [
    'handle',
    'title',
    'description',
    'type',
    'status',
    'tags',
    'option1 name',
    'option1 value',
    'option2 name',
    'option2 value',
    'option3 name',
    'option3 value',
    'sku',
    'price',
    'compare_at_price',
    'stock',
    'weight_g',
    'image',
  ];
  const lines = [header.join(',')];
  const decimal = (n: number | null) => (n === null ? '' : (n / 100).toFixed(2));
  for (const p of all) {
    const variants = p.variants.filter((v) => v.status !== 'archived');
    variants.forEach((v, i) => {
      const names = Object.keys(v.option_values);
      lines.push(
        [
          p.slug,
          i === 0 ? p.title : '',
          i === 0 ? p.description : '',
          i === 0 ? p.type : '',
          i === 0 ? p.status : '',
          i === 0 ? p.tags.join(', ') : '',
          names[0] ?? '',
          names[0] ? v.option_values[names[0]] : '',
          names[1] ?? '',
          names[1] ? v.option_values[names[1]] : '',
          names[2] ?? '',
          names[2] ? v.option_values[names[2]] : '',
          v.sku ?? '',
          decimal(v.price_amount),
          decimal(v.compare_at_amount),
          v.inventory ? v.inventory.on_hand : '',
          v.physical ? v.physical.weight_g : '',
          i === 0 ? (p.media[0]?.url ?? '') : '',
        ]
          .map(csvCell)
          .join(','),
      );
    });
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

const TEMPLATE = [
  'handle,title,type,status,price,compare_at_price,sku,stock,option1 name,option1 value,weight_g,image',
  'playera,Playera,physical,active,349.00,399.00,PL-M,10,Talla,M,200,https://example.com/playera.jpg',
  'playera,,,,349.00,,PL-L,5,,L,200,',
  'guia-ia,Guía para vender con IA,digital,active,199.00,,,,,,,',
].join('\n');

/** CSV import: check the file first (dry run), then import. */
function ImportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const [csv, setCsv] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (text: string) => sellbase.admin.products.import({ csv: text, dry_run: true }),
  });
  const run = useMutation({
    mutationFn: () => sellbase.admin.products.import({ csv: csv ?? '', dry_run: false }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] }),
  });
  const report = run.data ?? check.data;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.products.import.title}
      footer={
        report && !run.data && report.products.length > 0 ? (
          <Button onClick={() => run.mutate()} loading={run.isPending}>
            {t.products.import.run}
          </Button>
        ) : undefined
      }
    >
      <div className="sb:flex sb:flex-col sb:gap-4">
        <p className="sb:text-[var(--sba-text-subdued)]">{t.products.import.hint}</p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="productos.csv"
          className="sb:w-fit sb:font-medium sb:text-[var(--sba-link)] sb:hover:underline"
        >
          {t.products.import.template}
        </a>
        <Field label={t.products.import.file}>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sb:rounded-[var(--sba-card-radius)] sb:border sb:border-dashed sb:border-[#b5b5b5] sb:p-4"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              setCsv(text);
              run.reset();
              check.mutate(text);
            }}
          />
        </Field>
        <ErrorAlert error={check.error ?? run.error} />
        {report && (
          <div className="sb:flex sb:flex-col sb:gap-3" data-testid="import-report">
            <Banner tone={run.data || !report.errors.length ? 'success' : 'warning'}>
              {run.data
                ? t.products.import.done(report.created, report.updated)
                : t.products.import.summary(report.created, report.updated)}
            </Banner>
            {report.errors.length > 0 && (
              <div>
                <p className="sb:mb-1 sb:font-semibold">{t.products.import.rowErrors}</p>
                <ul className="sb:flex sb:flex-col sb:gap-1">
                  {report.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      <span className="sb:font-semibold">{t.products.import.row(e.row)}:</span>{' '}
                      {e.message}{' '}
                      <span className="sb:text-[var(--sba-text-subdued)]">{e.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Actions over the selected products; price changes show a preview before applying. */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: (message: string) => void }) {
  const { sellbase, t, currency } = useAdmin();
  const qc = useQueryClient();
  const b = t.products.bulk;
  const [pricing, setPricing] = useState(false);
  const [mode, setMode] = useState<'percent' | 'amount' | 'set'>('percent');
  const [value, setValue] = useState('');
  const price = () => {
    if (mode === 'percent') return { mode, value: Math.round(Number(value) * 100) };
    const negative = value.trim().startsWith('-');
    const minor = toMinorUnits(value.replace('-', '').trim() || '0', currency);
    return { mode, value: negative ? -minor : minor };
  };
  const status = useMutation({
    mutationFn: (action: 'publish' | 'draft' | 'archive') =>
      sellbase.admin.products.bulk({ product_ids: ids, action }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] });
      onDone(b.done(r.updated));
    },
  });
  const preview = useMutation({
    mutationFn: () =>
      sellbase.admin.products.bulk({ product_ids: ids, action: 'price', price: price() }),
  });
  const apply = useMutation({
    mutationFn: () =>
      sellbase.admin.products.bulk({
        product_ids: ids,
        action: 'price',
        price: price(),
        confirm: true,
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] });
      setPricing(false);
      onDone(b.done(r.updated));
    },
  });

  return (
    <div
      className="sb:flex sb:flex-wrap sb:items-center sb:gap-2 sb:border-b sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:px-3 sb:py-2"
      data-testid="bulk-bar"
    >
      <span className="sb:mr-2 sb:font-semibold">{b.selected(ids.length)}</span>
      <Button variant="secondary" size="sm" onClick={() => status.mutate('publish')}>
        {b.publish}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => status.mutate('draft')}>
        {b.draft}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => status.mutate('archive')}>
        {b.archive}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setPricing(true)}>
        {b.price}
      </Button>
      <ErrorAlert error={status.error} />
      <Modal
        open={pricing}
        onClose={() => {
          setPricing(false);
          preview.reset();
        }}
        title={`${b.price} · ${b.selected(ids.length)}`}
        footer={
          preview.data ? (
            <>
              <Button variant="secondary" onClick={() => preview.reset()}>
                {b.cancel}
              </Button>
              <Button onClick={() => apply.mutate()} loading={apply.isPending}>
                {b.apply}
              </Button>
            </>
          ) : (
            <Button onClick={() => preview.mutate()} disabled={!value} loading={preview.isPending}>
              {b.preview}
            </Button>
          )
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          <div className="sb:grid sb:gap-3 sb:sm:grid-cols-2">
            <Field label={b.mode}>
              <Select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  preview.reset();
                }}
              >
                {(['percent', 'amount', 'set'] as const).map((k) => (
                  <option key={k} value={k}>
                    {b.modes[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={b.value} {...(mode === 'set' ? {} : { hint: b.valueHint })}>
              <Input
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  preview.reset();
                }}
              />
            </Field>
          </div>
          <ErrorAlert error={preview.error ?? apply.error} />
          {preview.data && (
            <div className="sb:overflow-hidden sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)]">
              <Table head={['', b.from, b.to]}>
                {preview.data.preview.map((row) => (
                  <tr key={row.variant_id} data-testid="price-preview-row">
                    <td className={td}>{row.title}</td>
                    <td className={`${td} sb:text-[var(--sba-text-subdued)] sb:line-through`}>
                      {formatMoney(row.from_amount, currency)}
                    </td>
                    <td className={`${td} sb:font-semibold`}>
                      {formatMoney(row.to_amount, currency)}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
