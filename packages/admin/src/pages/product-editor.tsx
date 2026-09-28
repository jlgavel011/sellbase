import { toDecimalString, toMinorUnits, type AdminProduct } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useAdmin } from '../context.js';
import { Icon } from '../icons.js';
import { Link, useRouter } from '../router.js';
import { Layout, Page, siteUrlOf, useSaveBar, useSlot, useStore } from '../shell.js';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ErrorAlert,
  Field,
  Input,
  InputGroup,
  Menu,
  Modal,
  PageSkeleton,
  Select,
  Textarea,
  cx,
  readFileAsBase64,
  useToast,
} from '../ui.js';
import { ProductStatusBadge } from './products.js';

type ProductType = 'physical' | 'digital' | 'service';
type Status = 'draft' | 'active' | 'archived';
const MAX_IMAGE_BYTES = 5_000_000;

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

interface VariantRow {
  id?: string;
  option_values: Record<string, string>;
  price: string;
  compareAt: string;
  sku: string;
  tracked: boolean;
  quantity: string;
  continueSelling: boolean;
  files: { id: string; file_name: string }[];
}

interface Option {
  name: string;
  values: string[];
}

interface FormState {
  title: string;
  description: string;
  status: Status;
  type: ProductType;
  slug: string;
  tags: string[];
  collectionIds: string[];
  seoTitle: string;
  seoDescription: string;
  options: Option[];
  variants: VariantRow[];
  requiresShipping: boolean;
  weight: string;
  dims: { length_cm: number; width_cm: number; height_cm: number };
  service: ServiceForm;
  resourceIds: string[];
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

const emptyVariant = (): VariantRow => ({
  option_values: {},
  price: '',
  compareAt: '',
  sku: '',
  tracked: true,
  quantity: '0',
  continueSelling: false,
  files: [],
});

const emptyForm = (): FormState => ({
  title: '',
  description: '',
  status: 'draft',
  type: 'physical',
  slug: '',
  tags: [],
  collectionIds: [],
  seoTitle: '',
  seoDescription: '',
  options: [],
  variants: [emptyVariant()],
  requiresShipping: true,
  weight: '',
  dims: { length_cm: 0, width_cm: 0, height_cm: 0 },
  service: emptyService(),
  resourceIds: [],
});

const variantTitle = (options: Option[], ov: Record<string, string>) =>
  options
    .map((o) => ov[o.name])
    .filter(Boolean)
    .join(' / ') || 'Default';
const keyOf = (options: Option[], ov: Record<string, string>) =>
  JSON.stringify(options.map((o) => ov[o.name] ?? ''));

/** Every combination of option values, in order. */
function combinations(options: Option[]): Record<string, string>[] {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  return usable.reduce<Record<string, string>[]>(
    (acc, o) => acc.flatMap((combo) => o.values.map((v) => ({ ...combo, [o.name]: v }))),
    [{}],
  );
}

/** Rebuilds the variant rows for new options, keeping what was typed for combos that remain. */
function regenerate(options: Option[], previous: VariantRow[]): VariantRow[] {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  const template = previous[0] ?? emptyVariant();
  if (usable.length === 0) {
    const single = previous.find((v) => Object.keys(v.option_values).length === 0) ?? template;
    return [{ ...single, option_values: {} }];
  }
  // Matched by values in option order, so renaming an option keeps what was typed.
  const byValues = (ov: Record<string, string>) => JSON.stringify(Object.values(ov));
  const byKey = new Map(previous.map((v) => [byValues(v.option_values), v]));
  return combinations(usable).map((ov) => {
    const found = byKey.get(byValues(ov));
    return found
      ? { ...found, option_values: ov }
      : {
          ...emptyVariant(),
          option_values: ov,
          price: template.price,
          compareAt: template.compareAt,
          tracked: template.tracked,
          continueSelling: template.continueSelling,
        };
  });
}

function fromProduct(p: AdminProduct): FormState {
  const live = p.variants.filter((v) => v.status !== 'archived');
  let options: Option[] = [];
  for (const v of live) {
    for (const [name, value] of Object.entries(v.option_values)) {
      let opt = options.find((o) => o.name === name);
      if (!opt) {
        opt = { name, values: [] };
        options.push(opt);
      }
      if (!opt.values.includes(value)) opt.values.push(value);
    }
  }
  // Older products: several variants with titles but no option values.
  const legacy = options.length === 0 && live.length > 1;
  if (legacy) options = [{ name: 'Variante', values: live.map((v) => v.title) }];
  const first = live[0];
  const s = first?.service;
  return {
    title: p.title,
    description: p.description,
    status: p.status,
    type: p.type,
    slug: p.slug,
    tags: p.tags,
    collectionIds: p.collection_ids,
    seoTitle: p.seo.title ?? '',
    seoDescription: p.seo.description ?? '',
    options,
    variants: live.map((v) => ({
      id: v.id,
      option_values: legacy ? { Variante: v.title } : v.option_values,
      price: toDecimalString(v.price_amount, v.currency),
      compareAt: v.compare_at_amount ? toDecimalString(v.compare_at_amount, v.currency) : '',
      sku: v.sku ?? '',
      tracked: Boolean(v.inventory),
      quantity: v.inventory ? String(v.inventory.on_hand) : '0',
      continueSelling: v.inventory?.policy === 'continue',
      files: v.digital_assets.map((a) => ({ id: a.id, file_name: a.file_name })),
    })),
    requiresShipping: first?.physical?.requires_shipping ?? true,
    weight: first?.physical ? String(first.physical.weight_g) : '',
    dims: {
      length_cm: first?.physical?.length_cm ?? 0,
      width_cm: first?.physical?.width_cm ?? 0,
      height_cm: first?.physical?.height_cm ?? 0,
    },
    service: s
      ? {
          duration: String(s.duration_min),
          bufferBefore: String(s.buffer_before_min),
          bufferAfter: String(s.buffer_after_min),
          capacity: String(s.capacity),
          deposit:
            s.deposit_amount && first ? toDecimalString(s.deposit_amount, first.currency) : '',
          location: s.location_type,
          meetingUrl: s.online_meeting_url ?? '',
          minNotice: String(s.min_notice_min),
          window: String(s.booking_window_days),
        }
      : emptyService(),
    resourceIds: p.resource_ids,
  };
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const moneyOk = (value: string) => /^\d+([.,]\d{1,2})?$/.test(value.trim());
const toMinor = (value: string, currency: string) =>
  toMinorUnits(value.trim().replace(',', '.'), currency);

function buildBody(
  form: FormState,
  id: string | undefined,
  currency: string,
  originalSlug: string,
) {
  const usable = form.options.filter((o) => o.name.trim() && o.values.length > 0);
  const s = form.service;
  return {
    ...(id ? { id } : {}),
    type: form.type,
    title: form.title.trim(),
    status: form.status,
    description: form.description,
    tags: form.tags,
    collection_ids: form.collectionIds,
    seo: { title: form.seoTitle, description: form.seoDescription },
    ...(form.slug && form.slug !== originalSlug ? { slug: form.slug } : {}),
    options: usable,
    variants: form.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}),
      title: variantTitle(usable, v.option_values),
      sku: v.sku.trim() || null,
      option_values: v.option_values,
      price_amount: toMinor(v.price || '0', currency),
      compare_at_amount: v.compareAt.trim() ? toMinor(v.compareAt, currency) : null,
      ...(v.tracked && form.type !== 'service'
        ? {
            inventory: {
              on_hand: Number(v.quantity || 0),
              policy: v.continueSelling ? ('continue' as const) : ('deny' as const),
            },
          }
        : {}),
      ...(form.type === 'physical'
        ? {
            physical: {
              weight_g: Number(form.weight || 0),
              ...form.dims,
              requires_shipping: form.requiresShipping,
              hs_code: null,
            },
          }
        : {}),
      ...(form.type === 'service'
        ? {
            service: {
              duration_min: Number(s.duration || 60),
              buffer_before_min: Number(s.bufferBefore || 0),
              buffer_after_min: Number(s.bufferAfter || 0),
              capacity: Number(s.capacity || 1),
              deposit_amount: s.deposit ? toMinor(s.deposit, currency) : null,
              location_type: s.location,
              online_meeting_url: s.location === 'online' && s.meetingUrl ? s.meetingUrl : null,
              booking_window_days: Number(s.window || 60),
              min_notice_min: Number(s.minNotice || 0),
              slot_interval_min: null,
            },
          }
        : {}),
    })),
    ...(form.type === 'service' ? { resource_ids: form.resourceIds } : {}),
  };
}

interface PendingImage {
  key: string;
  file: File;
  preview: string;
}

export function ProductFormPage({ id }: { id?: string }) {
  const { sellbase, t, currency } = useAdmin();
  const { navigate } = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['sellbase-admin', 'product', id],
    queryFn: () => sellbase.admin.products.get(id ?? ''),
    enabled: Boolean(id),
  });
  const bottom = useSlot('product.form.bottom', id ? { productId: id } : {});
  const [initial, setInitial] = useState<FormState>(emptyForm);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ title?: string; price?: string }>({});
  const [archiving, setArchiving] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const p = existing.data;
    if (!p || loadedFor.current === p.updated_at) return;
    loadedFor.current = p.updated_at;
    const next = fromProduct(p);
    setInitial(next);
    setForm(next);
  }, [existing.data]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);
  const dirty =
    JSON.stringify(form) !== JSON.stringify(initial) || pending.length > 0 || Boolean(pendingFile);

  const refresh = (productId: string) => {
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'product', productId] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'inventory'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const product = await sellbase.admin.products.upsert(
        buildBody(form, id, currency, initial.slug),
      );
      // New products: upload what was dropped before the product existed, in order.
      let latest = product;
      for (const img of pending) {
        latest = await sellbase.admin.products.addMedia(product.id, {
          file_name: img.file.name,
          content_base64: await readFileAsBase64(img.file),
          alt: form.title,
        });
      }
      const firstVariant = product.variants.find((v) => v.status !== 'archived');
      if (pendingFile && firstVariant) {
        await sellbase.admin.variants.uploadFile(firstVariant.id, {
          file_name: pendingFile.name,
          content_base64: await readFileAsBase64(pendingFile),
        });
        latest = await sellbase.admin.products.get(product.id);
      }
      return latest;
    },
    onSuccess: (product) => {
      for (const img of pending) URL.revokeObjectURL(img.preview);
      setPending([]);
      setPendingFile(null);
      refresh(product.id);
      qc.setQueryData(['sellbase-admin', 'product', product.id], product);
      if (!id) {
        toast(t.editor.created);
        navigate(`/products/${product.id}`);
      } else {
        const next = fromProduct(product);
        loadedFor.current = product.updated_at;
        setInitial(next);
        setForm(next);
        toast(t.editor.saved);
      }
    },
    onError: (e) => toast((e as { message?: string }).message ?? t.common.error, { error: true }),
  });

  const submit = () => {
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = t.editor.required;
    if (form.variants.some((v) => !moneyOk(v.price))) next.price = t.editor.priceRequired;
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast(next.title ?? next.price ?? '', { error: true });
      return;
    }
    save.mutate();
  };
  const discard = () => {
    setForm(initial);
    for (const img of pending) URL.revokeObjectURL(img.preview);
    setPending([]);
    setPendingFile(null);
    setErrors({});
  };
  useSaveBar(dirty ? { onSave: submit, onDiscard: discard, saving: save.isPending } : null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !save.isPending) submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const archive = useMutation({
    mutationFn: () => sellbase.admin.products.archive(id ?? ''),
    onSuccess: () => {
      refresh(id ?? '');
      toast(t.editor.archived);
      navigate('/products');
    },
  });
  const duplicate = useMutation({
    mutationFn: async () => {
      const copy = await sellbase.admin.products.upsert({
        ...buildBody(
          { ...form, variants: form.variants.map(({ id: _id, ...v }) => ({ ...v, sku: '' })) },
          undefined,
          currency,
          '',
        ),
        title: `${form.title} (copia)`,
        status: 'draft',
      } as never);
      for (const m of existing.data?.media ?? []) {
        await sellbase.admin.products.addMedia(copy.id, { url: m.url, alt: m.alt });
      }
      return copy;
    },
    onSuccess: (copy) => {
      refresh(copy.id);
      navigate(`/products/${copy.id}`);
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });

  if (id && existing.isLoading) return <PageSkeleton />;
  if (id && existing.error) return <ErrorAlert error={existing.error} />;

  const hasOptions = form.options.some((o) => o.name.trim() && o.values.length > 0);
  const single = form.variants[0] ?? emptyVariant();
  const updateSingle = (patch: Partial<VariantRow>) =>
    set(
      'variants',
      form.variants.map((v, i) => (i === 0 ? { ...v, ...patch } : v)),
    );

  return (
    <Page
      title={id ? form.title || initial.title || '…' : t.editor.add}
      backTo="/products"
      backLabel={t.editor.back}
      badges={id ? <ProductStatusBadge status={initial.status} /> : undefined}
      actions={
        id ? (
          <Menu
            label={t.list.more}
            items={[
              { label: t.editor.duplicate, icon: 'copy', onClick: () => duplicate.mutate() },
              initial.status !== 'archived' && {
                label: t.products.archive,
                icon: 'trash',
                destructive: true,
                onClick: () => setArchiving(true),
              },
            ]}
          />
        ) : undefined
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Layout
          aside={
            <>
              <StatusCard form={form} set={set} />
              <OrganizationCard form={form} set={set} locked={Boolean(id)} />
            </>
          }
        >
          <Card>
            <div className="sb:flex sb:flex-col sb:gap-4">
              <Field label={t.editor.titleLabel} error={errors.title}>
                <Input
                  value={form.title}
                  placeholder={t.editor.titlePlaceholder}
                  aria-invalid={Boolean(errors.title)}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
              <Field label={t.editor.description}>
                <Textarea
                  value={form.description}
                  rows={6}
                  placeholder={t.editor.descriptionPlaceholder}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <MediaCard
            product={existing.data ?? null}
            pending={pending}
            setPending={setPending}
            title={form.title}
            onChanged={() => refresh(id ?? '')}
          />

          {!hasOptions && (
            <Card title={t.editor.pricing}>
              <div className="sb:grid sb:gap-3 sb:sm:grid-cols-2">
                <Field label={t.editor.price} error={errors.price}>
                  <InputGroup
                    prefix="$"
                    suffix={currency}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={t.editor.price}
                    aria-invalid={Boolean(errors.price)}
                    value={single.price}
                    onChange={(e) => updateSingle({ price: e.target.value })}
                  />
                </Field>
                <Field label={t.editor.compareAt} hint={t.editor.compareAtHint}>
                  <InputGroup
                    prefix="$"
                    suffix={currency}
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={t.editor.compareAt}
                    value={single.compareAt}
                    onChange={(e) => updateSingle({ compareAt: e.target.value })}
                  />
                </Field>
              </div>
            </Card>
          )}

          {form.type !== 'service' && !hasOptions && (
            <Card title={t.editor.inventory}>
              <div className="sb:flex sb:flex-col sb:gap-3">
                <Checkbox
                  label={t.editor.track}
                  hint={t.editor.trackHint}
                  checked={single.tracked}
                  disabled={Boolean(single.id) && initial.variants[0]?.tracked}
                  onChange={(e) => updateSingle({ tracked: e.target.checked })}
                />
                {single.tracked && (
                  <div className="sb:grid sb:gap-3 sb:sm:grid-cols-2">
                    <Field label={t.editor.quantity}>
                      <Input
                        inputMode="numeric"
                        value={single.quantity}
                        onChange={(e) =>
                          updateSingle({ quantity: e.target.value.replace(/[^\d-]/g, '') })
                        }
                      />
                    </Field>
                    <Field label={t.editor.sku}>
                      <Input
                        value={single.sku}
                        onChange={(e) => updateSingle({ sku: e.target.value })}
                      />
                    </Field>
                    <Checkbox
                      className="sb:sm:col-span-2"
                      label={t.editor.continueSelling}
                      checked={single.continueSelling}
                      onChange={(e) => updateSingle({ continueSelling: e.target.checked })}
                    />
                  </div>
                )}
                {!single.tracked && (
                  <Field label={t.editor.sku}>
                    <Input
                      value={single.sku}
                      onChange={(e) => updateSingle({ sku: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </Card>
          )}

          {form.type === 'physical' && (
            <Card title={t.editor.shipping}>
              <div className="sb:flex sb:flex-col sb:gap-3">
                <Checkbox
                  label={t.editor.physical}
                  checked={form.requiresShipping}
                  onChange={(e) => set('requiresShipping', e.target.checked)}
                />
                {form.requiresShipping && (
                  <Field label={t.editor.weight} className="sb:sm:w-1/2">
                    <InputGroup
                      suffix="g"
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={t.editor.weight}
                      value={form.weight}
                      onChange={(e) => set('weight', e.target.value.replace(/\D/g, ''))}
                    />
                  </Field>
                )}
              </div>
            </Card>
          )}

          {form.type !== 'service' && (
            <VariantsCard form={form} set={set} priceError={errors.price} />
          )}

          {form.type === 'digital' && (
            <DigitalCard
              form={form}
              pendingFile={pendingFile}
              setPendingFile={setPendingFile}
              onUploaded={() => refresh(id ?? '')}
            />
          )}

          {form.type === 'service' && <ServiceCard form={form} set={set} />}

          <SeoCard form={form} set={set} />

          {bottom}
        </Layout>
      </form>
      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        title={t.editor.archiveTitle(form.title)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setArchiving(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="critical" onClick={() => archive.mutate()} loading={archive.isPending}>
              {t.products.archive}
            </Button>
          </>
        }
      >
        <p>{t.editor.archiveConfirm}</p>
        <ErrorAlert error={archive.error} />
      </Modal>
    </Page>
  );
}

type SetField = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

// ── Aside cards ──────────────────────────────────────────────────────────────

function StatusCard({ form, set }: { form: FormState; set: SetField }) {
  const { t } = useAdmin();
  return (
    <Card title={t.editor.status}>
      <Field label={t.editor.status} labelHidden hint={t.editor.statusHint[form.status]}>
        <Select value={form.status} onChange={(e) => set('status', e.target.value as Status)}>
          <option value="active">{t.products.statuses.active}</option>
          <option value="draft">{t.products.statuses.draft}</option>
          {form.status === 'archived' && (
            <option value="archived">{t.products.statuses.archived}</option>
          )}
        </Select>
      </Field>
    </Card>
  );
}

function OrganizationCard({
  form,
  set,
  locked,
}: {
  form: FormState;
  set: SetField;
  locked: boolean;
}) {
  const { sellbase, t } = useAdmin();
  const collections = useQuery({
    queryKey: ['sellbase-admin', 'collections'],
    queryFn: () => sellbase.admin.collections.list(),
  });
  const [tag, setTag] = useState('');
  const addTag = () => {
    const value = tag.trim().replace(/,$/, '');
    if (value && !form.tags.includes(value)) set('tags', [...form.tags, value]);
    setTag('');
  };
  return (
    <Card title={t.editor.organization}>
      <div className="sb:flex sb:flex-col sb:gap-4">
        <Field
          label={t.editor.type}
          hint={locked ? t.editor.typeLocked : t.editor.typeHints[form.type]}
        >
          <Select
            value={form.type}
            disabled={locked}
            onChange={(e) => set('type', e.target.value as ProductType)}
          >
            <option value="physical">{t.products.types.physical}</option>
            <option value="digital">{t.products.types.digital}</option>
            <option value="service">{t.products.types.service}</option>
          </Select>
        </Field>
        <div className="sb:flex sb:flex-col sb:gap-1.5">
          <span className="sb:text-[var(--sba-text-strong)]">{t.editor.collections}</span>
          {collections.data && collections.data.data.length === 0 && (
            <p className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{t.editor.noCollections}</p>
          )}
          <div className="sb:flex sb:max-h-40 sb:flex-col sb:gap-1.5 sb:overflow-y-auto">
            {collections.data?.data.map((c) => (
              <Checkbox
                key={c.id}
                label={c.title}
                checked={form.collectionIds.includes(c.id)}
                onChange={(e) =>
                  set(
                    'collectionIds',
                    e.target.checked
                      ? [...form.collectionIds, c.id]
                      : form.collectionIds.filter((x) => x !== c.id),
                  )
                }
              />
            ))}
          </div>
          <Link
            to="/products/collections"
            className="sb:w-fit sb:text-xs sb:font-medium sb:text-[var(--sba-link)] sb:hover:underline"
          >
            {t.editor.manageCollections}
          </Link>
        </div>
        <Field label={t.editor.tags}>
          <Input
            value={tag}
            placeholder={t.editor.tagsPlaceholder}
            onChange={(e) => setTag(e.target.value)}
            onBlur={addTag}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag();
              }
            }}
          />
        </Field>
        {form.tags.length > 0 && (
          <div className="sb:-mt-2 sb:flex sb:flex-wrap sb:gap-1.5">
            {form.tags.map((tg) => (
              <span key={tg} className="sba-badge sb:pr-1">
                {tg}
                <button
                  type="button"
                  aria-label={t.editor.removeTag(tg)}
                  className="sb:grid sb:h-4 sb:w-4 sb:cursor-pointer sb:place-items-center sb:rounded sb:hover:bg-black/10"
                  onClick={() =>
                    set(
                      'tags',
                      form.tags.filter((x) => x !== tg),
                    )
                  }
                >
                  <Icon name="x" className="sb:h-3 sb:w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Media ────────────────────────────────────────────────────────────────────

type MediaTile = { key: string; url: string; alt: string; pending: boolean; mediaId?: string };

function MediaCard({
  product,
  pending,
  setPending,
  title,
  onChanged,
}: {
  product: AdminProduct | null;
  pending: PendingImage[];
  setPending: (next: PendingImage[]) => void;
  title: string;
  onChanged: () => void;
}) {
  const { sellbase, t } = useAdmin();
  const toast = useToast();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<MediaTile | null>(null);
  const [alt, setAlt] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [uploading, setUploading] = useState(0);

  const tiles: MediaTile[] = product
    ? product.media.map((m) => ({
        key: m.id,
        url: m.url,
        alt: m.alt,
        pending: false,
        mediaId: m.id,
      }))
    : pending.map((p) => ({ key: p.key, url: p.preview, alt: p.file.name, pending: true }));

  const apply = (next: AdminProduct) => {
    qc.setQueryData(['sellbase-admin', 'product', next.id], next);
    onChanged();
  };

  const accept = (files: File[]) => {
    const images: File[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) toast(t.editor.notImage(f.name), { error: true });
      else if (f.size > MAX_IMAGE_BYTES) toast(t.editor.tooBig(f.name), { error: true });
      else images.push(f);
    }
    return images;
  };

  const addFiles = async (files: File[]) => {
    const images = accept(files);
    if (images.length === 0) return;
    if (!product) {
      setPending([
        ...pending,
        ...images.map((file) => ({
          key: `${file.name}-${crypto.randomUUID()}`,
          file,
          preview: URL.createObjectURL(file),
        })),
      ]);
      return;
    }
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        apply(
          await sellbase.admin.products.addMedia(product.id, {
            file_name: file.name,
            content_base64: await readFileAsBase64(file),
            alt: title,
          }),
        );
      } catch (e) {
        toast((e as Error).message, { error: true });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      sellbase.admin.products.updateMedia(
        product?.id ?? '',
        ids.map((mediaId) => ({ id: mediaId })),
      ),
    onSuccess: apply,
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const saveAlt = useMutation({
    mutationFn: (tile: MediaTile) =>
      sellbase.admin.products.updateMedia(product?.id ?? '', [{ id: tile.mediaId ?? '', alt }]),
    onSuccess: (next) => {
      apply(next);
      setEditing(null);
      // Keep the order: the edited image moved first in the request only for its alt.
      reorder.mutate(tiles.map((x) => x.mediaId ?? ''));
    },
  });
  const remove = useMutation({
    mutationFn: (mediaId: string) =>
      sellbase.admin.products.removeMedia(product?.id ?? '', mediaId),
    onSuccess: (next) => {
      apply(next);
      setEditing(null);
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const addUrl = useMutation({
    mutationFn: () => sellbase.admin.products.addMedia(product?.id ?? '', { url, alt: title }),
    onSuccess: (next) => {
      apply(next);
      setUrl('');
      setUrlOpen(false);
    },
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= tiles.length || from === to) return;
    if (!product) {
      const next = [...pending];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      setPending(next);
      return;
    }
    const ids = tiles.map((x) => x.mediaId ?? '');
    const [item] = ids.splice(from, 1);
    if (item) ids.splice(to, 0, item);
    // Optimistic: show the new order right away.
    qc.setQueryData(['sellbase-admin', 'product', product.id], {
      ...product,
      media: ids.flatMap((mid, position) => {
        const m = product.media.find((x) => x.id === mid);
        return m ? [{ ...m, position }] : [];
      }),
    });
    reorder.mutate(ids);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.types.includes('text/x-sellbase-media')) return;
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const addTile = (big: boolean) => (
    <button
      type="button"
      onClick={() => fileInput.current?.click()}
      className={cx(
        'sba-dropzone sb:flex sb:cursor-pointer sb:flex-col sb:items-center sb:justify-center sb:gap-1 sb:p-3 sb:text-center',
        big ? 'sb:min-h-44 sb:w-full' : 'sb:aspect-square sb:w-full',
      )}
    >
      {big ? (
        <>
          <span className="sb:flex sb:gap-2">
            <span className={cx('sba-btn sba-btn-secondary sb:pointer-events-none')}>
              {t.editor.upload}
            </span>
          </span>
          <span className="sb:text-[var(--sba-text-subdued)]">{t.editor.drop}</span>
          <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{t.editor.formats}</span>
        </>
      ) : (
        <Icon name="plus" className="sb:h-5 sb:w-5 sb:text-[var(--sba-text-subdued)]" />
      )}
    </button>
  );

  return (
    <Card
      title={t.editor.media}
      actions={
        product ? (
          <Button variant="plain" onClick={() => setUrlOpen(true)}>
            {t.editor.addUrl}
          </Button>
        ) : undefined
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!e.dataTransfer.types.includes('text/x-sellbase-media')) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
        data-dragging={dragging}
        className={cx(
          'sb:rounded-[var(--sba-card-radius)]',
          dragging && 'sb:outline sb:outline-2 sb:outline-dashed sb:outline-[#005bd3]',
        )}
        data-testid="media-dropzone"
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="sb:sr-only"
          aria-label={t.editor.upload}
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {tiles.length === 0 && uploading === 0 ? (
          addTile(true)
        ) : (
          <ul className="sb:grid sb:grid-cols-3 sb:gap-2 sb:sm:grid-cols-5">
            {tiles.map((tile, i) => (
              <li
                key={tile.key}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i);
                  e.dataTransfer.setData('text/x-sellbase-media', String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  move(dragIndex, i);
                  setDragIndex(null);
                }}
                className={cx(
                  'sb:group sb:relative sb:overflow-hidden sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)]',
                  i === 0 ? 'sb:col-span-2 sb:row-span-2' : 'sb:aspect-square',
                  dragIndex === i && 'sb:opacity-40',
                )}
                data-testid="media-tile"
              >
                <img
                  src={tile.url}
                  alt={tile.alt}
                  className="sb:h-full sb:w-full sb:cursor-grab sb:object-cover"
                  draggable={false}
                />
                {i === 0 && (
                  <span className="sb:absolute sb:left-2 sb:top-2 sb:rounded-lg sb:bg-white/95 sb:shadow">
                    <Badge>{t.editor.main}</Badge>
                  </span>
                )}
                {tile.pending && (
                  <span className="sb:absolute sb:bottom-2 sb:left-2">
                    <Badge tone="blue">{t.editor.pending}</Badge>
                  </span>
                )}
                <div className="sb:absolute sb:right-1.5 sb:top-1.5 sb:flex sb:gap-1 sb:opacity-100 sb:transition sb:sm:opacity-0 sb:sm:group-hover:opacity-100 sb:focus-within:opacity-100">
                  {!tile.pending && (
                    <button
                      type="button"
                      className="sb:grid sb:h-7 sb:w-7 sb:cursor-pointer sb:place-items-center sb:rounded-lg sb:bg-white/95 sb:shadow"
                      aria-label={`${t.editor.alt}: ${tile.alt || tile.url}`}
                      onClick={() => {
                        setEditing(tile);
                        setAlt(tile.alt);
                      }}
                    >
                      <Icon name="pencil" className="sb:h-3.5 sb:w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="sb:grid sb:h-7 sb:w-7 sb:cursor-pointer sb:place-items-center sb:rounded-lg sb:bg-white/95 sb:text-[var(--sba-critical)] sb:shadow"
                    aria-label={t.editor.removeImage}
                    onClick={() => {
                      if (tile.pending) {
                        const gone = pending.find((p) => p.key === tile.key);
                        if (gone) URL.revokeObjectURL(gone.preview);
                        setPending(pending.filter((p) => p.key !== tile.key));
                      } else if (tile.mediaId) remove.mutate(tile.mediaId);
                    }}
                  >
                    <Icon name="trash" className="sb:h-3.5 sb:w-3.5" />
                  </button>
                </div>
                {tiles.length > 1 && (
                  <div className="sb:absolute sb:bottom-1.5 sb:right-1.5 sb:flex sb:gap-1 sb:opacity-0 sb:transition sb:group-hover:opacity-100 sb:focus-within:opacity-100">
                    <button
                      type="button"
                      disabled={i === 0}
                      className="sb:grid sb:h-6 sb:w-6 sb:cursor-pointer sb:place-items-center sb:rounded-md sb:bg-white/95 sb:shadow sb:disabled:hidden"
                      aria-label={t.editor.moveLeft}
                      onClick={() => move(i, i - 1)}
                    >
                      <Icon name="chevronLeft" className="sb:h-3.5 sb:w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={i === tiles.length - 1}
                      className="sb:grid sb:h-6 sb:w-6 sb:cursor-pointer sb:place-items-center sb:rounded-md sb:bg-white/95 sb:shadow sb:disabled:hidden"
                      aria-label={t.editor.moveRight}
                      onClick={() => move(i, i + 1)}
                    >
                      <Icon name="chevronRight" className="sb:h-3.5 sb:w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <li
                key={`up-${i}`}
                className="sba-skeleton sb:grid sb:aspect-square sb:place-items-center sb:text-xs sb:text-[var(--sba-text-subdued)]"
              >
                {t.editor.uploading}
              </li>
            ))}
            <li>{addTile(false)}</li>
          </ul>
        )}
      </div>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={t.editor.alt}
        footer={
          <>
            <Button
              variant="critical"
              icon="trash"
              onClick={() => editing?.mediaId && remove.mutate(editing.mediaId)}
              loading={remove.isPending}
            >
              {t.editor.removeImage}
            </Button>
            <span className="sb:flex-1" />
            <Button onClick={() => editing && saveAlt.mutate(editing)} loading={saveAlt.isPending}>
              {t.shell.save}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="sb:flex sb:flex-col sb:gap-3 sb:sm:flex-row">
            <img
              src={editing.url}
              alt=""
              className="sb:h-40 sb:w-40 sb:rounded-lg sb:border sb:border-[var(--sba-border)] sb:object-cover"
            />
            <Field label={t.editor.alt} hint={t.editor.altHint} className="sb:flex-1">
              <Textarea value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
      <Modal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        title={t.editor.addUrl}
        size="sm"
        footer={
          <Button
            onClick={() => addUrl.mutate()}
            disabled={!/^https?:\/\//.test(url)}
            loading={addUrl.isPending}
          >
            {t.editor.addUrlButton}
          </Button>
        }
      >
        <Field label="URL">
          <Input
            type="url"
            value={url}
            placeholder={t.editor.urlPlaceholder}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <div className="sb:mt-2">
          <ErrorAlert error={addUrl.error} />
        </div>
      </Modal>
    </Card>
  );
}

// ── Variants ─────────────────────────────────────────────────────────────────

function VariantsCard({
  form,
  set,
  priceError,
}: {
  form: FormState;
  set: SetField;
  priceError?: string | undefined;
}) {
  const { t, currency } = useAdmin();
  const [editing, setEditing] = useState(false);
  const usable = form.options.filter((o) => o.name.trim() && o.values.length > 0);
  const setOptions = (options: Option[]) => {
    set('options', options);
    set('variants', regenerate(options, form.variants));
  };
  const updateVariant = (i: number, patch: Partial<VariantRow>) =>
    set(
      'variants',
      form.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)),
    );
  const showEditor = editing || (form.options.length > 0 && usable.length === 0);

  return (
    <Card title={t.editor.variants} padded={false}>
      <div className="sb:px-4 sb:pb-4">
        {form.options.length === 0 && !editing ? (
          <Button
            variant="plain"
            icon="plus"
            onClick={() => {
              setEditing(true);
              setOptions([{ name: '', values: [] }]);
            }}
          >
            {t.editor.addOptions}
          </Button>
        ) : showEditor ? (
          <OptionsEditor
            options={form.options}
            onChange={setOptions}
            onDone={() => setEditing(false)}
          />
        ) : (
          <div className="sb:flex sb:flex-col sb:gap-2">
            {usable.map((o) => (
              <div key={o.name} className="sb:flex sb:flex-wrap sb:items-center sb:gap-1.5">
                <span className="sb:mr-1 sb:font-semibold">{o.name}</span>
                {o.values.map((v) => (
                  <Badge key={v}>{v}</Badge>
                ))}
              </div>
            ))}
            <div>
              <Button variant="secondary" size="sm" icon="pencil" onClick={() => setEditing(true)}>
                {t.editor.editOptions}
              </Button>
            </div>
          </div>
        )}
      </div>
      {usable.length > 0 && (
        <div className="sb:overflow-x-auto sb:border-t sb:border-[var(--sba-border)]">
          {priceError && (
            <div className="sb:p-3">
              <Banner tone="critical">{priceError}</Banner>
            </div>
          )}
          <table className="sba-table">
            <thead>
              <tr>
                <th>{t.editor.variant}</th>
                <th>{t.editor.price}</th>
                {form.variants.some((v) => v.tracked) && <th>{t.editor.quantity}</th>}
                <th>SKU</th>
              </tr>
            </thead>
            <tbody>
              {form.variants.map((v, i) => {
                const label = variantTitle(usable, v.option_values);
                return (
                  <tr key={keyOf(usable, v.option_values)} data-testid="variant-row">
                    <td className="sb:font-semibold">{label}</td>
                    <td className="sb:min-w-32">
                      <InputGroup
                        prefix="$"
                        inputMode="decimal"
                        placeholder="0.00"
                        aria-label={`${t.editor.price} ${label}`}
                        value={v.price}
                        aria-invalid={Boolean(priceError) && !moneyOk(v.price)}
                        onChange={(e) => updateVariant(i, { price: e.target.value })}
                      />
                    </td>
                    {form.variants.some((x) => x.tracked) && (
                      <td className="sb:min-w-24">
                        <Input
                          inputMode="numeric"
                          aria-label={`${t.editor.quantity} ${label}`}
                          value={v.tracked ? v.quantity : ''}
                          placeholder="∞"
                          onChange={(e) =>
                            updateVariant(i, {
                              tracked: true,
                              quantity: e.target.value.replace(/[^\d-]/g, ''),
                            })
                          }
                        />
                      </td>
                    )}
                    <td className="sb:min-w-28">
                      <Input
                        aria-label={`SKU ${label}`}
                        value={v.sku}
                        onChange={(e) => updateVariant(i, { sku: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="sb:border-t sb:border-[var(--sba-border)] sb:px-4 sb:py-2 sb:text-xs sb:text-[var(--sba-text-subdued)]">
            {form.variants.length} · {currency}
          </p>
        </div>
      )}
    </Card>
  );
}

function OptionsEditor({
  options,
  onChange,
  onDone,
}: {
  options: Option[];
  onChange: (o: Option[]) => void;
  onDone: () => void;
}) {
  const { t } = useAdmin();
  const [drafts, setDrafts] = useState<string[]>(options.map(() => ''));
  const update = (i: number, patch: Partial<Option>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const addValue = (i: number) => {
    const value = (drafts[i] ?? '').trim();
    const opt = options[i];
    if (!value || !opt || opt.values.includes(value)) return;
    update(i, { values: [...opt.values, value] });
    setDrafts(drafts.map((d, j) => (j === i ? '' : d)));
  };
  return (
    <div className="sb:flex sb:flex-col sb:gap-3">
      {options.map((o, i) => (
        <div
          key={i}
          className="sb:flex sb:flex-col sb:gap-2 sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)] sb:p-3"
          data-testid="option-editor"
        >
          <div className="sb:flex sb:items-end sb:gap-2">
            <Field label={t.editor.optionName} className="sb:flex-1">
              <Input
                value={o.name}
                placeholder={t.editor.optionNamePlaceholder}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </Field>
            <Button
              variant="tertiary"
              icon="trash"
              aria-label={t.editor.removeOption}
              onClick={() => {
                onChange(options.filter((_, j) => j !== i));
                setDrafts(drafts.filter((_, j) => j !== i));
              }}
            />
          </div>
          <Field label={t.editor.optionValues}>
            <div className="sb:flex sb:gap-2">
              <Input
                value={drafts[i] ?? ''}
                placeholder={t.editor.valuePlaceholder}
                onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addValue(i);
                  }
                }}
              />
              <Button variant="secondary" onClick={() => addValue(i)}>
                {t.editor.addValue}
              </Button>
            </div>
          </Field>
          {o.values.length > 0 && (
            <div className="sb:flex sb:flex-wrap sb:gap-1.5">
              {o.values.map((v) => (
                <span key={v} className="sba-badge sb:pr-1">
                  {v}
                  <button
                    type="button"
                    aria-label={t.editor.removeTag(v)}
                    className="sb:grid sb:h-4 sb:w-4 sb:cursor-pointer sb:place-items-center sb:rounded sb:hover:bg-black/10"
                    onClick={() => update(i, { values: o.values.filter((x) => x !== v) })}
                  >
                    <Icon name="x" className="sb:h-3 sb:w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-2">
        {options.length < 3 ? (
          <Button
            variant="plain"
            icon="plus"
            onClick={() => {
              onChange([...options, { name: '', values: [] }]);
              setDrafts([...drafts, '']);
            }}
          >
            {t.editor.addOption}
          </Button>
        ) : (
          <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
            {t.editor.maxOptions}
          </span>
        )}
        <Button
          variant="secondary"
          onClick={onDone}
          disabled={options.some((o) => !o.name.trim() || o.values.length === 0)}
        >
          {t.editor.optionsDone}
        </Button>
      </div>
    </div>
  );
}

// ── Digital, service, SEO ────────────────────────────────────────────────────

function DigitalCard({
  form,
  pendingFile,
  setPendingFile,
  onUploaded,
}: {
  form: FormState;
  pendingFile: File | null;
  setPendingFile: (f: File | null) => void;
  onUploaded: () => void;
}) {
  const { sellbase, t } = useAdmin();
  const toast = useToast();
  const usable = form.options.filter((o) => o.name.trim() && o.values.length > 0);
  const upload = useMutation({
    mutationFn: async ({ variantId, file }: { variantId: string; file: File }) =>
      sellbase.admin.variants.uploadFile(variantId, {
        file_name: file.name,
        content_base64: await readFileAsBase64(file),
      }),
    onSuccess: (asset) => {
      toast(`${asset.file_name} ✓`);
      onUploaded();
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  return (
    <Card title={t.editor.digital}>
      <p className="sb:mb-3 sb:text-[var(--sba-text-subdued)]">{t.editor.digitalHint}</p>
      <ul className="sb:flex sb:flex-col sb:gap-3">
        {form.variants.map((v, i) => (
          <li key={v.id ?? i} className="sb:flex sb:flex-col sb:gap-2">
            {usable.length > 0 && (
              <span className="sb:font-semibold">{variantTitle(usable, v.option_values)}</span>
            )}
            {v.files.map((f) => (
              <span key={f.id} className="sb:flex sb:items-center sb:gap-2">
                <Icon name="file" className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
                {f.file_name}
              </span>
            ))}
            {v.id ? (
              <label
                className={cx(
                  'sba-btn sba-btn-secondary sb:w-fit',
                  upload.isPending && 'sb:opacity-50',
                )}
              >
                <Icon name="upload" className="sb:h-4 sb:w-4" />
                {t.products.uploadFile}
                <input
                  type="file"
                  className="sb:sr-only"
                  aria-label={t.products.uploadFile}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && v.id) upload.mutate({ variantId: v.id, file });
                    e.target.value = '';
                  }}
                />
              </label>
            ) : form.variants.length === 1 ? (
              <label className="sba-btn sba-btn-secondary sb:w-fit">
                <Icon name="upload" className="sb:h-4 sb:w-4" />
                {pendingFile ? `${pendingFile.name} · ${t.editor.pending}` : t.products.uploadFile}
                <input
                  type="file"
                  className="sb:sr-only"
                  aria-label={t.products.uploadFile}
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                {t.editor.digitalSaveFirst}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ServiceCard({ form, set }: { form: FormState; set: SetField }) {
  const { sellbase, t, currency } = useAdmin();
  const resources = useQuery({
    queryKey: ['sellbase-admin', 'resources'],
    queryFn: () => sellbase.admin.resources.list(),
  });
  const s = form.service;
  const update = (patch: Partial<ServiceForm>) => set('service', { ...s, ...patch });
  const num = (key: keyof ServiceForm, label: string, suffix?: string) => (
    <Field key={key} label={label}>
      <InputGroup
        inputMode="numeric"
        aria-label={label}
        value={s[key]}
        {...(suffix ? { suffix } : {})}
        onChange={(e) =>
          update({ [key]: e.target.value.replace(/\D/g, '') } as Partial<ServiceForm>)
        }
      />
    </Field>
  );
  return (
    <Card title={t.editor.service}>
      <div className="sb:flex sb:flex-col sb:gap-4">
        <div className="sb:grid sb:gap-3 sb:sm:grid-cols-3">
          {num('duration', t.products.service.duration, 'min')}
          {num('capacity', t.products.service.capacity)}
          <Field label={`${t.products.service.deposit}`}>
            <InputGroup
              prefix="$"
              suffix={currency}
              inputMode="decimal"
              placeholder="0.00"
              aria-label={t.products.service.deposit}
              value={s.deposit}
              onChange={(e) => update({ deposit: e.target.value })}
            />
          </Field>
          {num('bufferBefore', t.products.service.bufferBefore, 'min')}
          {num('bufferAfter', t.products.service.bufferAfter, 'min')}
          {num('minNotice', t.products.service.minNotice, 'min')}
          {num('window', t.products.service.window)}
          <Field label={t.products.service.location}>
            <Select
              value={s.location}
              onChange={(e) => update({ location: e.target.value as 'in_person' | 'online' })}
            >
              <option value="in_person">{t.products.service.inPerson}</option>
              <option value="online">{t.products.service.online}</option>
            </Select>
          </Field>
          {s.location === 'online' && (
            <Field label={t.products.service.meetingUrl} className="sb:sm:col-span-2">
              <Input
                type="url"
                placeholder="https://meet.google.com/…"
                value={s.meetingUrl}
                onChange={(e) => update({ meetingUrl: e.target.value })}
              />
            </Field>
          )}
        </div>
        <div className="sb:flex sb:flex-col sb:gap-2">
          <span className="sb:font-semibold">{t.products.service.resources}</span>
          {resources.data && resources.data.data.length === 0 && (
            <p className="sb:text-[var(--sba-text-subdued)]">
              {t.products.service.noResources}{' '}
              <Link to="/agenda/resources" className="sb:text-[var(--sba-link)] sb:hover:underline">
                {t.agenda.resources}
              </Link>
            </p>
          )}
          {resources.data?.data.map((r) => (
            <Checkbox
              key={r.id}
              label={r.name}
              checked={form.resourceIds.includes(r.id)}
              onChange={(e) =>
                set(
                  'resourceIds',
                  e.target.checked
                    ? [...form.resourceIds, r.id]
                    : form.resourceIds.filter((x) => x !== r.id),
                )
              }
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function SeoCard({ form, set }: { form: FormState; set: SetField }) {
  const { t } = useAdmin();
  const store = useStore();
  const [open, setOpen] = useState(false);
  const site = siteUrlOf(store.data?.settings);
  const host = site ? new URL(site).host : (store.data?.name ?? '');
  const title = form.seoTitle || form.title;
  const description = (form.seoDescription || form.description).replace(/\s+/g, ' ').slice(0, 160);
  const preview = useMemo(
    () => t.editor.urlPreview(form.slug || slugify(form.title)),
    [form.slug, form.title, t],
  );
  return (
    <Card
      title={t.editor.seo}
      actions={
        <Button variant="plain" onClick={() => setOpen(!open)}>
          {t.editor.seoEdit}
        </Button>
      }
    >
      {title ? (
        <div className="sb:flex sb:flex-col sb:gap-0.5">
          <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
            {host}
            {preview.replace('…', '')}
          </span>
          <span className="sb:text-base sb:text-[#1a0dab]">{title}</span>
          {description && <span className="sb:text-[var(--sba-text-subdued)]">{description}</span>}
        </div>
      ) : (
        <p className="sb:text-[var(--sba-text-subdued)]">{t.editor.seoHint}</p>
      )}
      {open && (
        <div className="sb:mt-4 sb:flex sb:flex-col sb:gap-3 sb:border-t sb:border-[var(--sba-border)] sb:pt-4">
          <Field label={t.editor.seoTitle} hint={t.editor.chars(form.seoTitle.length, 70)}>
            <Input
              maxLength={70}
              value={form.seoTitle}
              placeholder={form.title}
              onChange={(e) => set('seoTitle', e.target.value)}
            />
          </Field>
          <Field
            label={t.editor.seoDescription}
            hint={t.editor.chars(form.seoDescription.length, 160)}
          >
            <Textarea
              maxLength={160}
              rows={3}
              value={form.seoDescription}
              onChange={(e) => set('seoDescription', e.target.value)}
            />
          </Field>
          <Field label="URL" hint={preview}>
            <InputGroup
              prefix="/products/"
              aria-label="URL"
              value={form.slug}
              onChange={(e) =>
                set(
                  'slug',
                  e.target.value
                    .toLowerCase()
                    .normalize('NFKD')
                    .replace(/[̀-ͯ]/g, '')
                    .replace(/[^a-z0-9-]+/g, '-')
                    .replace(/-+/g, '-'),
                )
              }
            />
          </Field>
        </div>
      )}
    </Card>
  );
}
