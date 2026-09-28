import { formatMoney, type AbandonedCheckout } from '@sellbase/sdk';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { Link, useRouter } from '../router.js';
import { Page, siteUrlOf, useStore } from '../shell.js';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Table,
  Tabs,
  Thumbnail,
  td,
  useToast,
} from '../ui.js';
import { TableSkeleton } from './products.js';

type Tab = 'all' | 'abandoned' | 'recovered';

/** Abandoned checkouts: who left without paying, and a one-click recovery email. */
export function AbandonedPage() {
  const { sellbase, t } = useAdmin();
  const { navigate } = useRouter();
  const store = useStore();
  const a = t.abandoned;
  const [tab, setTab] = useState<Tab>('all');
  const list = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'abandoned', tab],
    queryFn: ({ pageParam }) =>
      sellbase.admin.checkouts.abandoned({
        ...(tab !== 'all' ? { status: tab } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const settings = (store.data?.settings ?? {}) as {
    abandoned_checkout?: { auto_email?: boolean };
  };
  const hasSite = Boolean(siteUrlOf(store.data?.settings));
  const auto = Boolean(settings.abandoned_checkout?.auto_email);

  return (
    <Page title={a.title} subtitle={a.intro} width="wide">
      {store.data && !hasSite && (
        <Banner
          tone="warning"
          title={a.noSite}
          actions={
            <Button variant="secondary" onClick={() => navigate('/settings/checkout')}>
              {a.addSite}
            </Button>
          }
        />
      )}
      {store.data && hasSite && (
        <Banner
          tone={auto ? 'success' : 'info'}
          title={auto ? a.autoOn : a.autoOff}
          actions={
            <Button variant="secondary" onClick={() => navigate('/settings/checkout')}>
              {a.configure}
            </Button>
          }
        />
      )}
      <Card padded={false}>
        <div className="sb:border-b sb:border-[var(--sba-border)]">
          <Tabs
            label={a.title}
            value={tab}
            onChange={setTab}
            tabs={(['all', 'abandoned', 'recovered'] as const).map((id) => ({
              id,
              label: a.tabs[id],
            }))}
          />
        </div>
        {list.isLoading && <TableSkeleton />}
        <ErrorAlert error={list.error} />
        {list.data && rows.length === 0 && (
          <EmptyState icon="cart" title={a.empty} body={a.emptyBody} />
        )}
        {rows.length > 0 && (
          <Table head={[a.checkout, a.customer, a.items, a.recovery, a.total, '']}>
            {rows.map((c) => (
              <AbandonedRow key={c.id} checkout={c} canSend={hasSite} />
            ))}
          </Table>
        )}
        {list.hasNextPage && (
          <div className="sb:border-t sb:border-[var(--sba-border)] sb:p-3 sb:text-center">
            <Button
              variant="secondary"
              onClick={() => void list.fetchNextPage()}
              loading={list.isFetchingNextPage}
            >
              {a.loadMore}
            </Button>
          </div>
        )}
      </Card>
    </Page>
  );
}

function AbandonedRow({ checkout: c, canSend }: { checkout: AbandonedCheckout; canSend: boolean }) {
  const { sellbase, t, config } = useAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const a = t.abandoned;
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const send = useMutation({
    mutationFn: () => sellbase.admin.checkouts.sendRecovery(c.id, Boolean(c.recovery_sent_at)),
    onSuccess: (r) => {
      toast(a.sent(r.sent_to));
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'abandoned'] });
    },
    onError: (e) => toast((e as Error).message, { error: true }),
  });
  const first = c.items[0];

  return (
    <tr data-testid="abandoned-row">
      <td className={`${td} sb:whitespace-nowrap`}>
        <span className="sb:font-semibold sb:text-[var(--sba-text-strong)]">
          {when(c.created_at)}
        </span>
      </td>
      <td className={td}>{c.email}</td>
      <td className={td}>
        <span className="sb:flex sb:items-center sb:gap-2">
          <Thumbnail src={first?.image_url} size="sm" />
          <span className="sb:min-w-0">
            <span className="sb:block sb:truncate">
              {first?.title}
              {first && first.quantity > 1 ? ` × ${first.quantity}` : ''}
            </span>
            {c.items.length > 1 && (
              <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                {a.more(c.items.length - 1)}
              </span>
            )}
          </span>
        </span>
      </td>
      <td className={td}>
        {c.status === 'recovered' ? (
          <span className="sb:flex sb:flex-col sb:items-start sb:gap-0.5">
            <Badge tone="green" dot="full">
              {a.statuses.recovered}
            </Badge>
            {c.recovered_order && (
              <Link
                to={`/orders/${c.recovered_order.id}`}
                className="sb:text-xs sb:text-[var(--sba-link)] sb:hover:underline"
              >
                {a.order(c.recovered_order.number)}
              </Link>
            )}
          </span>
        ) : c.status === 'in_progress' ? (
          <Badge tone="blue">{a.statuses.in_progress}</Badge>
        ) : c.recovery_sent_at ? (
          <Badge tone="yellow" dot="full">
            {a.sentAt(when(c.recovery_sent_at))}
          </Badge>
        ) : (
          <Badge tone="amber" dot="empty">
            {a.notSent}
          </Badge>
        )}
      </td>
      <td className={`${td} sb:whitespace-nowrap sb:font-semibold`}>
        {formatMoney(c.amount_total, c.currency, locale)}
      </td>
      <td className={`${td} sb:text-right`}>
        {c.status === 'abandoned' && (
          <span className="sb:inline-flex sb:gap-1.5">
            {c.recovery_url && (
              <Button
                variant="tertiary"
                size="sm"
                icon="link"
                aria-label={a.copyLink}
                title={a.copyLink}
                onClick={() => {
                  void navigator.clipboard?.writeText(c.recovery_url ?? '');
                  toast(a.copied);
                }}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              icon="mail"
              disabled={!canSend}
              loading={send.isPending}
              onClick={() => send.mutate()}
            >
              {c.recovery_sent_at ? a.resend : a.send}
            </Button>
          </span>
        )}
      </td>
    </tr>
  );
}
