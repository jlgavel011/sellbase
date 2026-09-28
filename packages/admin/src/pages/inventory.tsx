import type { InventoryItem } from '@sellbase/sdk';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { Page } from '../shell.js';
import {
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Input,
  Table,
  Tabs,
  Thumbnail,
  cx,
  td,
  useToast,
} from '../ui.js';
import { TableSkeleton } from './products.js';

type StockTab = 'all' | 'low' | 'out';

/** Stock per variant with inline adjustments (Shopify's Inventory page). */
export function InventoryPage() {
  const { sellbase, t } = useAdmin();
  const [tab, setTab] = useState<StockTab>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const filters = { stock: tab, ...(q ? { q } : {}) };
  const items = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'inventory', filters],
    queryFn: ({ pageParam }) =>
      sellbase.admin.inventory.list({
        ...filters,
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = items.data?.pages.flatMap((p) => p.data) ?? [];
  const p = t.inventoryPage;

  return (
    <Page title={p.title} subtitle={p.intro} width="wide">
      <Card padded={false}>
        <div className="sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-2 sb:border-b sb:border-[var(--sba-border)] sb:pr-2">
          <Tabs
            label={p.title}
            value={tab}
            onChange={setTab}
            tabs={(['all', 'low', 'out'] as const).map((id) => ({ id, label: p.tabs[id] }))}
          />
          <div className="sb:w-full sb:px-2 sb:pb-2 sb:sm:w-72 sb:sm:p-0">
            <Input
              type="search"
              aria-label={p.search}
              placeholder={p.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {tab === 'low' && (
          <p className="sb:border-b sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:px-4 sb:py-2 sb:text-xs sb:text-[var(--sba-text-subdued)]">
            {p.threshold(5)}
          </p>
        )}
        {items.isLoading && <TableSkeleton />}
        <ErrorAlert error={items.error} />
        {items.data && rows.length === 0 && (
          <EmptyState icon="inventory" title={p.empty} body={p.emptyBody} />
        )}
        {rows.length > 0 && (
          <Table head={['', p.product, p.sku, p.reserved, p.available, p.onHand]}>
            {rows.map((item) => (
              <InventoryRow key={item.variant_id} item={item} />
            ))}
          </Table>
        )}
        {items.hasNextPage && (
          <div className="sb:border-t sb:border-[var(--sba-border)] sb:p-3 sb:text-center">
            <Button
              variant="secondary"
              onClick={() => void items.fetchNextPage()}
              loading={items.isFetchingNextPage}
            >
              {t.customers.loadMore}
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}

function InventoryRow({ item }: { item: InventoryItem }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const p = t.inventoryPage;
  const [value, setValue] = useState(String(item.on_hand));
  useEffect(() => setValue(String(item.on_hand)), [item.on_hand]);
  const target = Number(value);
  const changed = value !== '' && Number.isInteger(target) && target !== item.on_hand;
  const adjust = useMutation({
    mutationFn: (delta: number) =>
      sellbase.admin.inventory.adjust({ variant_id: item.variant_id, delta, reason: p.reason }),
    onSuccess: () => {
      toast(p.updated);
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'inventory'] });
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'products'] });
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'product', item.product_id] });
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const title = item.variant_title && item.variant_title !== 'Default' ? item.variant_title : null;

  return (
    <tr data-testid="inventory-row">
      <td className={`${td} sb:w-12`}>
        <Thumbnail src={item.image_url} size="sm" />
      </td>
      <td className={td}>
        <Link
          to={`/products/${item.product_id}`}
          className="sb:font-semibold sb:text-[var(--sba-text-strong)] sb:hover:underline"
        >
          {item.product_title}
        </Link>
        {title && (
          <span className="sb:block sb:text-xs sb:text-[var(--sba-text-subdued)]">{title}</span>
        )}
      </td>
      <td className={`${td} sb:text-[var(--sba-text-subdued)]`}>{item.sku ?? '—'}</td>
      <td className={td}>{item.tracked ? item.reserved : '—'}</td>
      <td
        className={cx(
          td,
          'sb:font-semibold',
          item.tracked && item.available <= 0 && 'sb:text-[var(--sba-critical)]',
        )}
      >
        {item.tracked ? item.available : '∞'}
      </td>
      <td className={`${td} sb:w-56`}>
        {item.tracked ? (
          <form
            className="sb:flex sb:items-center sb:gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (changed) adjust.mutate(target - item.on_hand);
            }}
          >
            <Input
              inputMode="numeric"
              aria-label={`${p.onHand}: ${item.product_title}${title ? ` ${title}` : ''}`}
              value={value}
              className="sb:w-20"
              onChange={(e) => setValue(e.target.value.replace(/[^\d-]/g, ''))}
            />
            {changed && (
              <Button type="submit" size="sm" loading={adjust.isPending}>
                {p.save}
              </Button>
            )}
          </form>
        ) : (
          <span className="sb:text-[var(--sba-text-subdued)]">{p.untracked}</span>
        )}
      </td>
    </tr>
  );
}
