import type { Sellbase } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { PageTitle } from '../shell.js';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  Input,
  Spinner,
  Textarea,
} from '../ui.js';

type Collection = Awaited<ReturnType<Sellbase['admin']['collections']['list']>>['data'][number];

/** Collections: groups of products the storefront filters with ?collection=<slug>. */
export function CollectionsPage() {
  const { sellbase, t } = useAdmin();
  const collections = useQuery({
    queryKey: ['sellbase-admin', 'collections'],
    queryFn: () => sellbase.admin.collections.list(),
  });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const select = (id: string | 'new' | null) => {
    setNotice(null);
    setSelected(id);
  };
  const current = collections.data?.data.find((c) => c.id === selected) ?? null;
  const first = collections.data?.data[0]?.id;
  useEffect(() => {
    if (selected === null && first) setSelected(first);
  }, [first, selected]);
  const empty = collections.data?.data.length === 0 && selected !== 'new';

  return (
    <>
      <Link to="/products" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.collections.back}
      </Link>
      <PageTitle actions={<Button onClick={() => select('new')}>{t.collections.new}</Button>}>
        {t.collections.title}
      </PageTitle>
      {collections.isLoading && <Spinner label={t.common.loading} />}
      <ErrorAlert error={collections.error} />
      {notice && (
        <div className="sb:mb-4">
          <Alert tone="green">{notice}</Alert>
        </div>
      )}
      {empty && (
        <Card>
          <EmptyState
            title={t.collections.empty}
            prompt={t.collections.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        </Card>
      )}
      {!empty && (
        <div className="sb:grid sb:gap-6 sb:md:grid-cols-[14rem_1fr]">
          <nav className="sb:flex sb:flex-col sb:gap-1" aria-label={t.collections.title}>
            {collections.data?.data.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c.id)}
                className={`sb:rounded-[var(--sba-radius)] sb:px-3 sb:py-2 sb:text-left sb:text-sm ${selected === c.id ? 'sb:bg-white sb:font-medium sb:shadow-sm' : 'sb:hover:bg-white'}`}
              >
                {c.title}
                <span className="sb:block sb:text-xs sb:text-zinc-500">
                  {t.collections.count(c.product_ids.length)}
                </span>
              </button>
            ))}
          </nav>
          {(selected === 'new' || current) && (
            <CollectionForm
              key={selected ?? 'none'}
              collection={current}
              onSaved={(id) => {
                setSelected(id);
                setNotice(t.collections.saved);
              }}
              onDeleted={() => select(null)}
            />
          )}
        </div>
      )}
    </>
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

  return (
    <div className="sb:flex sb:flex-col sb:gap-6">
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
          <p className="sb:text-sm sb:text-zinc-500">{t.collections.noProducts}</p>
        )}
        {productIds.length > 0 && (
          <ol className="sb:mb-4 sb:flex sb:flex-col sb:gap-1 sb:text-sm">
            {productIds.map((id, i) => (
              <li
                key={id}
                className="sb:flex sb:items-center sb:gap-2 sb:rounded-[var(--sba-radius)] sb:bg-zinc-50 sb:px-3 sb:py-1.5"
              >
                <span className="sb:w-5 sb:text-zinc-400">{i + 1}.</span>
                <span className="sb:flex-1">{byId.get(id)?.title ?? id}</span>
                <Button
                  variant="ghost"
                  className="sb:px-2 sb:py-0.5"
                  aria-label="↑"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  className="sb:px-2 sb:py-0.5"
                  aria-label="↓"
                  disabled={i === productIds.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </li>
            ))}
          </ol>
        )}
        <div className="sb:flex sb:flex-col sb:gap-2">
          {products.data?.data.map((p) => (
            <label key={p.id} className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
              <input
                type="checkbox"
                checked={productIds.includes(p.id)}
                onChange={(e) =>
                  setProductIds(
                    e.target.checked ? [...productIds, p.id] : productIds.filter((x) => x !== p.id),
                  )
                }
              />
              {p.title}
              {p.status !== 'active' && (
                <span className="sb:text-xs sb:text-zinc-400">({p.status})</span>
              )}
            </label>
          ))}
        </div>
      </Card>
      <ErrorAlert error={save.error ?? remove.error} />
      <div className="sb:flex sb:flex-wrap sb:gap-2">
        <Button onClick={() => save.mutate()} disabled={!title || save.isPending}>
          {t.collections.save}
        </Button>
        {collection &&
          (confirming ? (
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {t.collections.confirmRemove}
            </Button>
          ) : (
            <Button variant="ghost" className="sb:text-red-700" onClick={() => setConfirming(true)}>
              {t.collections.remove}
            </Button>
          ))}
      </div>
    </div>
  );
}
