import type { Sellbase } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Icon } from '../icons.js';
import { Page } from '../shell.js';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  PageSkeleton,
  Textarea,
  Thumbnail,
  cx,
  useToast,
} from '../ui.js';

type Collection = Awaited<ReturnType<Sellbase['admin']['collections']['list']>>['data'][number];

/** Collections: groups of products the storefront filters with ?collection=<slug>. */
export function CollectionsPage() {
  const { sellbase, t } = useAdmin();
  const collections = useQuery({
    queryKey: ['sellbase-admin', 'collections'],
    queryFn: () => sellbase.admin.collections.list(),
  });
  const toast = useToast();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const select = (id: string | 'new' | null) => setSelected(id);
  const products = useQuery({
    queryKey: ['sellbase-admin', 'products', 'all'],
    queryFn: () => sellbase.admin.products.search({ limit: 100 }),
  });
  const imageOf = (ids: string[]) =>
    products.data?.data.find((p) => p.id === ids[0])?.media[0]?.url ?? null;
  const current = collections.data?.data.find((c) => c.id === selected) ?? null;
  const first = collections.data?.data[0]?.id;
  useEffect(() => {
    if (selected === null && first) setSelected(first);
  }, [first, selected]);
  const empty = collections.data?.data.length === 0 && selected !== 'new';

  if (collections.isLoading) return <PageSkeleton />;

  return (
    <Page
      title={t.collections.title}
      backTo="/products"
      backLabel={t.nav.products}
      width="wide"
      actions={<Button onClick={() => select('new')}>{t.collections.new}</Button>}
    >
      <ErrorAlert error={collections.error} />
      {empty ? (
        <Card>
          <EmptyState
            icon="collections"
            title={t.collections.empty}
            prompt={t.collections.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
            action={<Button onClick={() => select('new')}>{t.collections.new}</Button>}
          />
        </Card>
      ) : (
        <div className="sb:grid sb:items-start sb:gap-4 sb:lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav
            className="sba-card sb:flex sb:flex-col sb:gap-0.5 sb:p-1.5"
            aria-label={t.collections.title}
          >
            {collections.data?.data.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c.id)}
                className={cx(
                  'sb:flex sb:items-center sb:gap-3 sb:rounded-lg sb:px-2 sb:py-2 sb:text-left sb:hover:bg-[var(--sba-surface-hover)]',
                  selected === c.id && 'sb:bg-[var(--sba-surface-selected)]',
                )}
              >
                <Thumbnail src={imageOf(c.product_ids)} size="sm" icon="collections" />
                <span className="sb:min-w-0">
                  <span className="sb:block sb:truncate sb:font-semibold sb:text-[var(--sba-text-strong)]">
                    {c.title}
                  </span>
                  <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">
                    {t.collections.count(c.product_ids.length)}
                  </span>
                </span>
              </button>
            ))}
            {selected === 'new' && (
              <span className="sb:flex sb:items-center sb:gap-3 sb:rounded-lg sb:bg-[var(--sba-surface-selected)] sb:px-2 sb:py-2 sb:font-semibold">
                <Thumbnail size="sm" icon="plus" />
                {t.collections.new}
              </span>
            )}
          </nav>
          {(selected === 'new' || current) && (
            <CollectionForm
              key={selected ?? 'none'}
              collection={current}
              onSaved={(id) => {
                setSelected(id);
                toast(t.collections.saved);
              }}
              onDeleted={() => select(null)}
            />
          )}
        </div>
      )}
    </Page>
  );
}

function CollectionForm({
  collection,
  onSaved,
  onDeleted,
}: {
  collection: Collection | null;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const products = useQuery({
    queryKey: ['sellbase-admin', 'products', 'all'],
    queryFn: () => sellbase.admin.products.search({ limit: 100 }),
  });
  const [title, setTitle] = useState(collection?.title ?? '');
  const [description, setDescription] = useState(collection?.description ?? '');
  const [productIds, setProductIds] = useState<string[]>(collection?.product_ids ?? []);
  const [confirming, setConfirming] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'collections'] });

  const save = useMutation({
    mutationFn: () =>
      sellbase.admin.collections.upsert({
        ...(collection ? { id: collection.id } : {}),
        title,
        description,
        product_ids: productIds,
      }),
    onSuccess: (c) => {
      refresh();
      onSaved(c.id);
    },
  });
  const remove = useMutation({
    mutationFn: () => sellbase.admin.collections.delete(collection?.id ?? ''),
    onSuccess: () => {
      refresh();
      onDeleted();
    },
  });
  const byId = new Map((products.data?.data ?? []).map((p) => [p.id, p]));
  const move = (i: number, delta: number) => {
    const next = [...productIds];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + delta, 0, item);
    setProductIds(next);
  };

  const [filter, setFilter] = useState('');
  const available = (products.data?.data ?? []).filter(
    (p) => !filter || p.title.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="sb:flex sb:flex-col sb:gap-4">
      <Card>
        <div className="sb:flex sb:flex-col sb:gap-4">
          <Field
            label={t.collections.name}
            {...(collection ? { hint: t.collections.slugHint(collection.slug) } : {})}
          >
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t.collections.description}>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </Card>
      <Card title={t.collections.products}>
        {products.data?.data.length === 0 && (
          <p className="sb:text-[var(--sba-text-subdued)]">{t.collections.noProducts}</p>
        )}
        {productIds.length > 0 && (
          <ol className="sb:mb-4 sb:flex sb:flex-col sb:overflow-hidden sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)]">
            {productIds.map((id, i) => {
              const p = byId.get(id);
              return (
                <li
                  key={id}
                  className="sb:flex sb:items-center sb:gap-3 sb:border-b sb:border-[var(--sba-border)] sb:px-3 sb:py-2 last:sb:border-0"
                >
                  <span className="sb:w-5 sb:text-[var(--sba-text-subdued)]">{i + 1}</span>
                  <Thumbnail src={p?.media[0]?.url} size="sm" />
                  <span className="sb:flex-1 sb:font-medium">{p?.title ?? id}</span>
                  <Button
                    variant="tertiary"
                    size="sm"
                    icon="chevronLeft"
                    className="sb:rotate-90"
                    aria-label={t.editor.moveLeft}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <Button
                    variant="tertiary"
                    size="sm"
                    icon="chevronRight"
                    className="sb:rotate-90"
                    aria-label={t.editor.moveRight}
                    disabled={i === productIds.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <Button
                    variant="tertiary"
                    size="sm"
                    icon="x"
                    aria-label={t.editor.removeTag(p?.title ?? id)}
                    onClick={() => setProductIds(productIds.filter((x) => x !== id))}
                  />
                </li>
              );
            })}
          </ol>
        )}
        {(products.data?.data.length ?? 0) > 6 && (
          <div className="sb:mb-3 sb:flex sb:items-center sb:gap-2">
            <Icon name="search" className="sb:h-4 sb:w-4 sb:text-[var(--sba-text-subdued)]" />
            <Input
              type="search"
              value={filter}
              placeholder={t.products.search}
              aria-label={t.products.search}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        )}
        <div className="sb:grid sb:gap-2 sb:sm:grid-cols-2">
          {available.map((p) => (
            <Checkbox
              key={p.id}
              label={
                <span className="sb:flex sb:items-center sb:gap-2">
                  {p.title}
                  {p.status !== 'active' && (
                    <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      ({t.products.statuses[p.status]})
                    </span>
                  )}
                </span>
              }
              checked={productIds.includes(p.id)}
              onChange={(e) =>
                setProductIds(
                  e.target.checked ? [...productIds, p.id] : productIds.filter((x) => x !== p.id),
                )
              }
            />
          ))}
        </div>
      </Card>
      <ErrorAlert error={save.error ?? remove.error} />
      <div className="sb:flex sb:flex-row-reverse sb:flex-wrap sb:justify-between sb:gap-2">
        <Button onClick={() => save.mutate()} disabled={!title} loading={save.isPending}>
          {t.collections.save}
        </Button>
        {collection &&
          (confirming ? (
            <Button variant="critical" onClick={() => remove.mutate()} loading={remove.isPending}>
              {t.collections.confirmRemove}
            </Button>
          ) : (
            <Button
              variant="tertiary"
              icon="trash"
              className="sb:text-[var(--sba-critical)]"
              onClick={() => setConfirming(true)}
            >
              {t.collections.remove}
            </Button>
          ))}
      </div>
    </div>
  );
}
