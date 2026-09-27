import { formatMoney, toDecimalString, toMinorUnits } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '../context.js';
import { Link, useRouter } from '../router.js';
import { PageTitle, useSlot } from '../shell.js';
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
  Textarea,
  td,
} from '../ui.js';

type ProductType = 'physical' | 'digital' | 'service';
type Status = 'draft' | 'active' | 'archived';

interface VariantForm {
  id?: string;
  title: string;
  sku: string;
  price: string;
  stock: string;
  requires_shipping: boolean;
  weight_g: string;
  files: { id: string; file_name: string }[];
  service: ServiceForm;
}

interface ServiceForm {
  duration: string;
  bufferBefore: string;
  bufferAfter: string;
  capacity: string;
  deposit: string;
  location: 'in_person' | 'online';
  meetingUrl: string;
  minNotice: string;
  window: string;
}

const emptyService = (): ServiceForm => ({
  duration: '60',
  bufferBefore: '0',
  bufferAfter: '0',
  capacity: '1',
  deposit: '',
  location: 'in_person',
  meetingUrl: '',
  minNotice: '60',
  window: '60',
});

const emptyVariant = (): VariantForm => ({
  title: 'Default',
  sku: '',
  price: '',
  stock: '',
  requires_shipping: true,
  weight_g: '',
  files: [],
  service: emptyService(),
});

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ProductsPage() {
  const { sellbase, t } = useAdmin();
  const [q, setQ] = useState('');
  const products = useQuery({
    queryKey: ['sellbase-admin', 'products', q],
    queryFn: () => sellbase.admin.products.search(q ? { q } : {}),
  });
  const top = useSlot('products.list.top');
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const visible = products.data?.data.map((p) => p.id) ?? [];
  const allSelected = visible.length > 0 && visible.every((id) => selected.includes(id));

  return (
    <>
      <PageTitle
        actions={
          <div className="sb:flex sb:gap-2">
            <Button variant="outline" onClick={() => setImporting(!importing)}>
              {t.products.import.button}
            </Button>
            <Link
              to="/products/collections"
              className="sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-300 sb:bg-white sb:px-4 sb:py-2 sb:text-sm"
            >
              {t.collections.link}
            </Link>
            <Link
              to="/products/new"
              className="sb:rounded-[var(--sba-radius)] sb:bg-[var(--sba-primary)] sb:px-4 sb:py-2 sb:text-sm sb:font-medium sb:text-[var(--sba-primary-fg)]"
            >
              {t.products.new}
            </Link>
          </div>
        }
      >
        {t.products.title}
      </PageTitle>
      {top}
      {importing && <ImportPanel onClose={() => setImporting(false)} />}
      {notice && (
        <div className="sb:mb-4">
          <Alert tone="green">{notice}</Alert>
        </div>
      )}
      {selected.length > 0 && (
        <BulkBar
          ids={selected}
          onDone={(message) => {
            setSelected([]);
            setNotice(message);
          }}
        />
      )}
      <Card>
        <Input
          placeholder={t.products.search}
          aria-label={t.products.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sb:mb-4"
        />
        {products.isLoading && <Spinner label={t.common.loading} />}
        <ErrorAlert error={products.error} />
        {products.data && products.data.data.length === 0 && !q && (
          <EmptyState
            title={t.products.empty}
            prompt={t.products.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        )}
        {products.data && products.data.data.length > 0 && (
          <Table
            head={[
              <input
                key="all"
                type="checkbox"
                aria-label={t.products.bulk.selectAll}
                checked={allSelected}
                onChange={(e) => setSelected(e.target.checked ? visible : [])}
              />,
              t.products.name,
              t.products.type,
              t.products.status,
              t.products.price,
              t.products.stock,
            ]}
          >
            {products.data.data.map((p) => {
              const prices = p.variants
                .filter((v) => v.status === 'active')
                .map((v) => v.price_amount);
              const stock = p.variants.reduce(
                (n, v) => n + (v.inventory ? v.inventory.on_hand - v.inventory.reserved : 0),
                0,
              );
              const tracked = p.variants.some((v) => v.inventory);
              const currency = p.variants[0]?.currency ?? 'MXN';
              return (
                <tr key={p.id} className="sb:hover:bg-zinc-50" data-testid="product-row">
                  <td className={`${td} sb:w-8`}>
                    <input
                      type="checkbox"
                      aria-label={t.products.bulk.select(p.title)}
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, p.id]
                            : selected.filter((x) => x !== p.id),
                        )
                      }
                    />
                  </td>
                  <td className={td}>
                    <Link
                      to={`/products/${p.id}`}
                      className="sb:flex sb:items-center sb:gap-3 sb:font-medium"
                    >
                      {p.media[0] ? (
                        <img
                          src={p.media[0].url}
                          alt=""
                          className="sb:h-9 sb:w-9 sb:rounded sb:object-cover"
                        />
                      ) : (
                        <span className="sb:h-9 sb:w-9 sb:rounded sb:bg-zinc-100" />
                      )}
                      {p.title}
                    </Link>
                  </td>
                  <td className={td}>{t.products.types[p.type as ProductType] ?? p.type}</td>
                  <td className={td}>
                    <Badge tone={p.status === 'active' ? 'green' : 'neutral'}>
                      {t.products.statuses[p.status as Status]}
                    </Badge>
                  </td>
                  <td className={td}>
                    {prices.length ? formatMoney(Math.min(...prices), currency) : '—'}
                  </td>
                  <td className={td}>{tracked ? stock : '∞'}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}

export function ProductFormPage({ id }: { id?: string }) {
  const { sellbase, t, currency } = useAdmin();
  const { navigate, flash } = useRouter();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['sellbase-admin', 'product', id],
    queryFn: () => sellbase.admin.products.get(id ?? ''),
    enabled: Boolean(id),
  });
  const bottom = useSlot('product.form.bottom', ...(id ? [{ productId: id }] : []));

  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProductType>('physical');
  const [status, setStatus] = useState<Status>('draft');
  const [description, setDescription] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([emptyVariant()]);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const resources = useQuery({
    queryKey: ['sellbase-admin', 'resources'],
    queryFn: () => sellbase.admin.resources.list(),
    enabled: type === 'service',
  });
  const [imageUrl, setImageUrl] = useState('');
  const [saved, setSaved] = useState(flash === 'saved');
  const [formError, setFormError] = useState<unknown>(null);

  useEffect(() => {
    const p = existing.data;
    if (!p) return;
    setTitle(p.title);
    setType(p.type);
    setResourceIds(p.resource_ids);
    setStatus(p.status);
    setDescription(p.description);
    setVariants(
      p.variants
        .filter((v) => v.status !== 'archived')
        .map((v) => ({
          id: v.id,
          title: v.title,
          sku: v.sku ?? '',
          price: toDecimalString(v.price_amount, v.currency),
          stock: v.inventory ? String(v.inventory.on_hand) : '',
          requires_shipping: v.physical?.requires_shipping ?? true,
          weight_g: v.physical ? String(v.physical.weight_g) : '',
          files: v.digital_assets.map((a) => ({ id: a.id, file_name: a.file_name })),
          service: v.service
            ? {
                duration: String(v.service.duration_min),
                bufferBefore: String(v.service.buffer_before_min),
                bufferAfter: String(v.service.buffer_after_min),
                capacity: String(v.service.capacity),
                deposit: v.service.deposit_amount
                  ? toDecimalString(v.service.deposit_amount, v.currency)
                  : '',
                location: v.service.location_type,
                meetingUrl: v.service.online_meeting_url ?? '',
                minNotice: String(v.service.min_notice_min),
                window: String(v.service.booking_window_days),
              }
            : emptyService(),
        })),
    );
  }, [existing.data]);

  const refresh = (productId: string) => {
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'product', productId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...(id ? { id } : {}),
        type,
        title,
        status,
        description,
        variants: variants.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          title: v.title || 'Default',
          sku: v.sku || null,
          price_amount: toMinorUnits(v.price || '0', currency),
          ...(v.stock !== ''
            ? { inventory: { on_hand: Number(v.stock), policy: 'deny' as const } }
            : {}),
          ...(type === 'physical'
            ? {
                physical: {
                  weight_g: Number(v.weight_g || 0),
                  length_cm: 0,
                  width_cm: 0,
                  height_cm: 0,
                  requires_shipping: v.requires_shipping,
                  hs_code: null,
                },
              }
            : {}),
          ...(type === 'service'
            ? {
                service: {
                  duration_min: Number(v.service.duration || 60),
                  buffer_before_min: Number(v.service.bufferBefore || 0),
                  buffer_after_min: Number(v.service.bufferAfter || 0),
                  capacity: Number(v.service.capacity || 1),
                  deposit_amount: v.service.deposit
                    ? toMinorUnits(v.service.deposit, currency)
                    : null,
                  location_type: v.service.location,
                  online_meeting_url:
                    v.service.location === 'online' && v.service.meetingUrl
                      ? v.service.meetingUrl
                      : null,
                  booking_window_days: Number(v.service.window || 60),
                  min_notice_min: Number(v.service.minNotice || 0),
                  slot_interval_min: null,
                },
              }
            : {}),
        })),
        ...(type === 'service' ? { resource_ids: resourceIds } : {}),
      };
      return sellbase.admin.products.upsert(body);
    },
    onSuccess: (product) => {
      setSaved(true);
      setFormError(null);
      refresh(product.id);
      if (!id) navigate(`/products/${product.id}`, 'saved');
    },
    onError: setFormError,
  });

  const archive = useMutation({
    mutationFn: () => sellbase.admin.products.archive(id ?? ''),
    onSuccess: () => {
      refresh(id ?? '');
      navigate('/products');
    },
  });

  const addImage = useMutation({
    mutationFn: async (input: { url: string } | { file: File }) =>
      'url' in input
        ? sellbase.admin.products.addMedia(id ?? '', { url: input.url, alt: title })
        : sellbase.admin.products.addMedia(id ?? '', {
            file_name: input.file.name,
            content_base64: await readFileAsBase64(input.file),
            alt: title,
          }),
    onSuccess: () => {
      setImageUrl('');
      refresh(id ?? '');
    },
  });

  const uploadFile = useMutation({
    mutationFn: async ({ variantId, file }: { variantId: string; file: File }) =>
      sellbase.admin.variants.uploadFile(variantId, {
        file_name: file.name,
        content_base64: await readFileAsBase64(file),
      }),
    onSuccess: () => refresh(id ?? ''),
  });

  if (id && existing.isLoading) return <Spinner label={t.common.loading} />;
  if (id && existing.error) return <ErrorAlert error={existing.error} />;

  const update = (i: number, patch: Partial<VariantForm>) =>
    setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    try {
      save.mutate();
    } catch (error) {
      setFormError(error);
    }
  }

  return (
    <>
      <Link to="/products" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.products.back}
      </Link>
      <PageTitle>{id ? title || '…' : t.products.new}</PageTitle>
      <form onSubmit={submit} className="sb:flex sb:flex-col sb:gap-6">
        <Card>
          <div className="sb:grid sb:gap-4 sb:md:grid-cols-3">
            <div className="sb:md:col-span-3">
              <Field label={t.products.name}>
                <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
            <Field label={t.products.type}>
              <Select
                value={type}
                onChange={(e) => setType(e.target.value as ProductType)}
                disabled={Boolean(id)}
              >
                <option value="physical">{t.products.types.physical}</option>
                <option value="digital">{t.products.types.digital}</option>
                <option value="service">{t.products.types.service}</option>
              </Select>
            </Field>
            <Field label={t.products.status}>
              <Select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="draft">{t.products.statuses.draft}</option>
                <option value="active">{t.products.statuses.active}</option>
              </Select>
            </Field>
            <div className="sb:md:col-span-3">
              <Field label={t.products.description}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card
          title={t.products.variants}
          actions={
            <Button
              variant="outline"
              onClick={() => setVariants([...variants, { ...emptyVariant(), title: '' }])}
            >
              {t.products.addVariant}
            </Button>
          }
        >
          <div className="sb:flex sb:flex-col sb:gap-4">
            {variants.map((v, i) => (
              <div
                key={v.id ?? i}
                className="sb:grid sb:gap-3 sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:p-3 sb:md:grid-cols-4"
              >
                <Field label={t.products.variantTitle}>
                  <Input value={v.title} onChange={(e) => update(i, { title: e.target.value })} />
                </Field>
                <Field label={t.products.sku}>
                  <Input value={v.sku} onChange={(e) => update(i, { sku: e.target.value })} />
                </Field>
                <Field label={`${t.products.price} (${currency})`}>
                  <Input
                    required
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,2})?"
                    placeholder="199.00"
                    value={v.price}
                    onChange={(e) => update(i, { price: e.target.value })}
                  />
                </Field>
                {type !== 'service' && (
                  <Field label={t.products.stock}>
                    <Input
                      inputMode="numeric"
                      placeholder="∞"
                      value={v.stock}
                      onChange={(e) => update(i, { stock: e.target.value.replace(/\D/g, '') })}
                    />
                  </Field>
                )}
                {type === 'physical' && (
                  <>
                    <Field label={t.products.weight}>
                      <Input
                        inputMode="numeric"
                        value={v.weight_g}
                        onChange={(e) => update(i, { weight_g: e.target.value.replace(/\D/g, '') })}
                      />
                    </Field>
                    <label className="sb:flex sb:items-center sb:gap-2 sb:self-end sb:pb-2 sb:text-sm">
                      <input
                        type="checkbox"
                        checked={v.requires_shipping}
                        onChange={(e) => update(i, { requires_shipping: e.target.checked })}
                      />
                      {t.products.requiresShipping}
                    </label>
                  </>
                )}
                {type === 'service' && (
                  <div className="sb:grid sb:gap-3 sb:md:col-span-4 sb:md:grid-cols-4">
                    {(
                      [
                        ['duration', t.products.service.duration],
                        ['bufferBefore', t.products.service.bufferBefore],
                        ['bufferAfter', t.products.service.bufferAfter],
                        ['capacity', t.products.service.capacity],
                        ['minNotice', t.products.service.minNotice],
                        ['window', t.products.service.window],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label}>
                        <Input
                          inputMode="numeric"
                          value={v.service[key]}
                          onChange={(e) =>
                            update(i, {
                              service: { ...v.service, [key]: e.target.value.replace(/\D/g, '') },
                            })
                          }
                        />
                      </Field>
                    ))}
                    <Field label={`${t.products.service.deposit} (${currency})`}>
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={v.service.deposit}
                        onChange={(e) =>
                          update(i, { service: { ...v.service, deposit: e.target.value } })
                        }
                      />
                    </Field>
                    <Field label={t.products.service.location}>
                      <Select
                        value={v.service.location}
                        onChange={(e) =>
                          update(i, {
                            service: {
                              ...v.service,
                              location: e.target.value as 'in_person' | 'online',
                            },
                          })
                        }
                      >
                        <option value="in_person">{t.products.service.inPerson}</option>
                        <option value="online">{t.products.service.online}</option>
                      </Select>
                    </Field>
                    {v.service.location === 'online' && (
                      <div className="sb:md:col-span-2">
                        <Field label={t.products.service.meetingUrl}>
                          <Input
                            type="url"
                            placeholder="https://meet.google.com/…"
                            value={v.service.meetingUrl}
                            onChange={(e) =>
                              update(i, { service: { ...v.service, meetingUrl: e.target.value } })
                            }
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
                {type === 'digital' && v.id && (
                  <div className="sb:md:col-span-4">
                    <Field label={t.products.file}>
                      <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-2 sb:text-sm">
                        {v.files.map((f) => (
                          <Badge key={f.id} tone="blue">
                            {f.file_name}
                          </Badge>
                        ))}
                        <input
                          type="file"
                          aria-label={t.products.uploadFile}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && v.id) uploadFile.mutate({ variantId: v.id, file });
                          }}
                        />
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            ))}
          </div>
          <ErrorAlert error={uploadFile.error} />
        </Card>

        {id && (
          <Card title={t.products.images}>
            <div className="sb:mb-3 sb:flex sb:flex-wrap sb:gap-3">
              {existing.data?.media.map((m) => (
                <img
                  key={m.id}
                  src={m.url}
                  alt={m.alt}
                  className="sb:h-24 sb:w-24 sb:rounded sb:object-cover"
                />
              ))}
            </div>
            <div className="sb:flex sb:flex-wrap sb:gap-2">
              <Input
                type="url"
                placeholder="https://…"
                aria-label={t.products.addImage}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="sb:flex-1"
              />
              <Button
                variant="outline"
                disabled={!imageUrl || addImage.isPending}
                onClick={() => addImage.mutate({ url: imageUrl })}
              >
                {t.products.addImage}
              </Button>
              <input
                type="file"
                accept="image/*"
                aria-label={`${t.products.addImage} (archivo)`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addImage.mutate({ file });
                }}
              />
            </div>
            <ErrorAlert error={addImage.error} />
          </Card>
        )}

        {type === 'service' && (
          <Card title={t.products.service.resources}>
            {resources.data && resources.data.data.length === 0 && (
              <p className="sb:text-sm sb:text-zinc-500">{t.products.service.noResources}</p>
            )}
            <div className="sb:flex sb:flex-col sb:gap-2">
              {resources.data?.data.map((r) => (
                <label key={r.id} className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
                  <input
                    type="checkbox"
                    checked={resourceIds.includes(r.id)}
                    onChange={(e) =>
                      setResourceIds(
                        e.target.checked
                          ? [...resourceIds, r.id]
                          : resourceIds.filter((x) => x !== r.id),
                      )
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </Card>
        )}

        {bottom}

        <ErrorAlert error={formError} />
        {saved && <Alert tone="green">{t.products.saved}</Alert>}
        <div className="sb:flex sb:justify-between sb:gap-3">
          {id ? (
            <Button variant="danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
              {t.products.archive}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={save.isPending}>
            {t.products.save}
          </Button>
        </div>
      </form>
    </>
  );
}

const TEMPLATE = [
  'handle,title,type,status,price,compare_at_price,sku,stock,option1 name,option1 value,weight_g,image',
  'playera,Playera,physical,active,349.00,399.00,PL-M,10,Talla,M,200,https://example.com/playera.jpg',
  'playera,,,,349.00,,PL-L,5,,L,200,',
  'guia-ia,Guía para vender con IA,digital,active,199.00,,,,,,,',
].join('\n');

/** CSV import: check the file first (dry run), then import. */
function ImportPanel({ onClose }: { onClose: () => void }) {
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
    <Card
      title={t.products.import.title}
      actions={
        <Button variant="ghost" onClick={onClose}>
          {t.products.import.close}
        </Button>
      }
    >
      <div className="sb:mb-6 sb:flex sb:flex-col sb:gap-4">
        <p className="sb:text-sm sb:text-zinc-600">{t.products.import.hint}</p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="productos.csv"
          className="sb:text-sm sb:text-[var(--sba-primary)] sb:underline"
        >
          {t.products.import.template}
        </a>
        <Field label={t.products.import.file}>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sb:text-sm"
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
            <Alert tone={run.data || !report.errors.length ? 'green' : 'amber'}>
              {run.data
                ? t.products.import.done(report.created, report.updated)
                : t.products.import.summary(report.created, report.updated)}
            </Alert>
            {report.errors.length > 0 && (
              <div className="sb:text-sm">
                <p className="sb:mb-1 sb:font-medium">{t.products.import.rowErrors}</p>
                <ul className="sb:flex sb:flex-col sb:gap-1">
                  {report.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      <span className="sb:font-medium">{t.products.import.row(e.row)}:</span>{' '}
                      {e.message} <span className="sb:text-zinc-500">{e.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!run.data && report.products.length > 0 && (
              <div>
                <Button onClick={() => run.mutate()} disabled={run.isPending}>
                  {t.products.import.run}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Actions over the selected products; price changes show a preview before applying. */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: (message: string) => void }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const b = t.products.bulk;
  const [pricing, setPricing] = useState(false);
  const [mode, setMode] = useState<'percent' | 'amount' | 'set'>('percent');
  const [value, setValue] = useState('');
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const currency = store.data?.default_currency ?? 'MXN';
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
      onDone(b.done(r.updated));
    },
  });

  return (
    <div
      className="sb:mb-4 sb:flex sb:flex-col sb:gap-3 sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:bg-white sb:p-3"
      data-testid="bulk-bar"
    >
      <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
        <span className="sb:mr-2 sb:text-sm sb:font-medium">{b.selected(ids.length)}</span>
        <Button
          variant="outline"
          className="sb:px-3 sb:py-1"
          onClick={() => status.mutate('publish')}
        >
          {b.publish}
        </Button>
        <Button
          variant="outline"
          className="sb:px-3 sb:py-1"
          onClick={() => status.mutate('draft')}
        >
          {b.draft}
        </Button>
        <Button
          variant="outline"
          className="sb:px-3 sb:py-1"
          onClick={() => status.mutate('archive')}
        >
          {b.archive}
        </Button>
        <Button variant="outline" className="sb:px-3 sb:py-1" onClick={() => setPricing(!pricing)}>
          {b.price}
        </Button>
      </div>
      {pricing && (
        <div className="sb:flex sb:flex-col sb:gap-3">
          <div className="sb:grid sb:gap-3 sb:md:grid-cols-3">
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
            <div className="sb:self-center">
              <Button
                variant="outline"
                onClick={() => preview.mutate()}
                disabled={!value || preview.isPending}
              >
                {b.preview}
              </Button>
            </div>
          </div>
          <ErrorAlert error={preview.error ?? apply.error ?? status.error} />
          {preview.data && (
            <>
              <Table head={['', b.from, b.to]}>
                {preview.data.preview.map((row) => (
                  <tr key={row.variant_id} data-testid="price-preview-row">
                    <td className={td}>{row.title}</td>
                    <td className={`${td} sb:text-zinc-500 sb:line-through`}>
                      {formatMoney(row.from_amount, currency)}
                    </td>
                    <td className={`${td} sb:font-medium`}>
                      {formatMoney(row.to_amount, currency)}
                    </td>
                  </tr>
                ))}
              </Table>
              <div className="sb:flex sb:gap-2">
                <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
                  {b.apply}
                </Button>
                <Button variant="ghost" onClick={() => preview.reset()}>
                  {b.cancel}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
