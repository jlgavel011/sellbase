import type { Sellbase } from '@sellbase/sdk';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useAdmin } from '../context.js';
import { Link, useRouter } from '../router.js';
import { PageTitle } from '../shell.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  Input,
  Select,
  Spinner,
  Table,
  cx,
  td,
} from '../ui.js';

const SCOPES = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'customers:read',
  'discounts:write',
  'settings:write',
  'integrations:write',
  'refunds:write',
  'webhooks:write',
] as const;
type Scope = (typeof SCOPES)[number];

function useDateTime() {
  const { config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  return (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Tabs shared by every Settings page. */
export function SettingsTabs() {
  const { t } = useAdmin();
  const { path } = useRouter();
  const tabs = [
    { to: '/settings', label: t.settings.tabs.store },
    { to: '/settings/team', label: t.settings.tabs.team },
    { to: '/settings/agents', label: t.settings.tabs.agents },
    { to: '/settings/webhooks', label: t.settings.tabs.webhooks },
  ];
  return (
    <nav
      className="sb:-mt-2 sb:mb-6 sb:flex sb:gap-1 sb:overflow-x-auto sb:border-b sb:border-zinc-200"
      aria-label={t.settings.title}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={cx(
            'sb:-mb-px sb:whitespace-nowrap sb:border-b-2 sb:px-3 sb:py-2 sb:text-sm',
            path === tab.to
              ? 'sb:border-[var(--sba-primary)] sb:font-medium'
              : 'sb:border-transparent sb:text-zinc-500 sb:hover:text-zinc-800',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

// ── Team ────────────────────────────────────────────────────────────────────

export function TeamPage() {
  const { sellbase, t, session, config } = useAdmin();
  const qc = useQueryClient();
  const date = useDateTime();
  const team = useQuery({
    queryKey: ['sellbase-admin', 'team'],
    queryFn: () => sellbase.admin.team.list(),
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'admin' | 'owner'>('staff');
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'team'] });
  const invite = useMutation({
    mutationFn: () =>
      sellbase.admin.team.invite({
        email,
        role,
        redirect_to: `${window.location.origin}${config.basePath ?? '/admin'}`,
      }),
    onSuccess: (m) => {
      setNotice(t.team.invited(m.email));
      setEmail('');
      refresh();
    },
  });
  const setMemberRole = useMutation({
    mutationFn: (v: { userId: string; role: 'staff' | 'admin' | 'owner' }) =>
      sellbase.admin.team.setRole(v.userId, v.role),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => sellbase.admin.team.remove(userId),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    invite.mutate();
  };

  return (
    <>
      <PageTitle>{t.settings.title}</PageTitle>
      <SettingsTabs />
      <div className="sb:flex sb:flex-col sb:gap-6">
        <p className="sb:text-sm sb:text-zinc-600">{t.team.intro}</p>
        <Card>
          <form
            onSubmit={submit}
            className="sb:grid sb:gap-3 sb:md:grid-cols-[1fr_12rem_auto] sb:md:items-end"
          >
            <Field label={t.team.email}>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t.team.role}>
              <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                {(['staff', 'admin', 'owner'] as const).map((r) => (
                  <option key={r} value={r}>
                    {t.team.roles[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={invite.isPending}>
              {t.team.invite}
            </Button>
          </form>
          <div className="sb:mt-3 sb:flex sb:flex-col sb:gap-2">
            <ErrorAlert error={invite.error} />
            {notice && <Alert tone="green">{notice}</Alert>}
          </div>
        </Card>
        <Card>
          {team.isLoading && <Spinner label={t.common.loading} />}
          <ErrorAlert error={team.error ?? setMemberRole.error ?? remove.error} />
          {team.data && (
            <Table head={[t.team.email, t.team.role, t.team.lastSeen, '']}>
              {team.data.data.map((m) => (
                <tr key={m.user_id} data-testid="team-row">
                  <td className={td}>
                    {m.email}
                    {m.user_id === session?.user.id && (
                      <span className="sb:ml-2 sb:text-xs sb:text-zinc-500">({t.team.you})</span>
                    )}
                    {m.invited && (
                      <span className="sb:ml-2">
                        <Badge tone="amber">{t.team.pending}</Badge>
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    <Select
                      aria-label={`${t.team.role} ${m.email}`}
                      value={m.role}
                      onChange={(e) =>
                        setMemberRole.mutate({
                          userId: m.user_id,
                          role: e.target.value as 'staff' | 'admin' | 'owner',
                        })
                      }
                    >
                      {(['staff', 'admin', 'owner'] as const).map((r) => (
                        <option key={r} value={r}>
                          {t.team.roles[r]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className={`${td} sb:text-zinc-500`}>
                    {m.last_sign_in_at ? date(m.last_sign_in_at) : t.team.never}
                  </td>
                  <td className={`${td} sb:text-right`}>
                    {m.user_id !== session?.user.id &&
                      (removing === m.user_id ? (
                        <Button
                          variant="danger"
                          className="sb:px-2 sb:py-1"
                          onClick={() => remove.mutate(m.user_id)}
                        >
                          {t.team.confirmRemove}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          className="sb:px-2 sb:py-1"
                          onClick={() => setRemoving(m.user_id)}
                        >
                          {t.team.remove}
                        </Button>
                      ))}
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

// ── AI agents: tokens + activity ────────────────────────────────────────────

type Token = Awaited<ReturnType<Sellbase['admin']['tokens']['list']>>['data'][number];

export function AgentsPage() {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const date = useDateTime();
  const a = t.agents;
  const tokens = useQuery({
    queryKey: ['sellbase-admin', 'tokens'],
    queryFn: () => sellbase.admin.tokens.list(),
  });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(
    SCOPES.filter((s) => s !== 'refunds:write' && s !== 'webhooks:write'),
  );
  const [expires, setExpires] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'tokens'] });
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'audit'] });
  };
  const create = useMutation({
    mutationFn: () =>
      sellbase.admin.tokens.create({
        name,
        scopes,
        ...(expires ? { expires_in_days: Number(expires) } : {}),
      }),
    onSuccess: () => {
      setName('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => sellbase.admin.tokens.revoke(id),
    onSuccess: () => {
      setRevoking(null);
      refresh();
    },
  });
  const activity = useInfiniteQuery({
    queryKey: ['sellbase-admin', 'audit', 'token', filter],
    queryFn: ({ pageParam }) =>
      sellbase.admin.audit({
        actor_type: 'token',
        limit: 20,
        ...(filter ? { actor_id: filter } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const entries = activity.data?.pages.flatMap((p) => p.data) ?? [];
  const tokenStatus = (tk: Token) =>
    tk.revoked_at
      ? a.revoked
      : tk.expires_at && new Date(tk.expires_at) < new Date()
        ? a.expired
        : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageTitle>{t.settings.title}</PageTitle>
      <SettingsTabs />
      <div className="sb:flex sb:flex-col sb:gap-6">
        <p className="sb:text-sm sb:text-zinc-600">{a.intro}</p>
        <Card title={a.tokens}>
          <form onSubmit={submit} className="sb:flex sb:flex-col sb:gap-4">
            <div className="sb:grid sb:gap-3 sb:md:grid-cols-[1fr_12rem]">
              <Field label={a.name}>
                <Input
                  required
                  placeholder={a.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={a.expires}>
                <Input
                  type="number"
                  min={1}
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </Field>
            </div>
            <fieldset>
              <legend className="sb:mb-2 sb:text-sm sb:font-medium sb:text-zinc-700">
                {a.scopes}
              </legend>
              <div className="sb:grid sb:gap-2 sb:sm:grid-cols-2 sb:lg:grid-cols-3">
                {SCOPES.map((scope) => (
                  <label key={scope} className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(e) =>
                        setScopes(
                          e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope),
                        )
                      }
                    />
                    {a.scopeNames[scope] ?? scope}
                  </label>
                ))}
              </div>
            </fieldset>
            {scopes.includes('refunds:write') && <Alert tone="amber">{a.refundsWarning}</Alert>}
            {scopes.includes('webhooks:write') && <Alert tone="amber">{a.webhooksWarning}</Alert>}
            <ErrorAlert error={create.error} />
            {create.data && (
              <div className="sb:flex sb:flex-col sb:gap-2" data-testid="new-token">
                <Alert tone="green">{a.copyNow}</Alert>
                <Input
                  readOnly
                  value={create.data.token}
                  onFocus={(e) => e.target.select()}
                  className="sb:font-mono"
                />
              </div>
            )}
            <div>
              <Button type="submit" disabled={!name || scopes.length === 0 || create.isPending}>
                {a.create}
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          {tokens.isLoading && <Spinner label={t.common.loading} />}
          <ErrorAlert error={tokens.error ?? revoke.error} />
          {tokens.data && tokens.data.data.length > 0 && (
            <Table head={[a.name, a.scopes, a.lastUsed, '']}>
              {tokens.data.data.map((tk) => {
                const status = tokenStatus(tk);
                return (
                  <tr
                    key={tk.id}
                    data-testid="token-row"
                    className={status ? 'sb:text-zinc-400' : ''}
                  >
                    <td className={td}>
                      <span className="sb:font-medium">{tk.name}</span>{' '}
                      {status && <Badge tone="red">{status}</Badge>}
                      <span className="sb:block sb:font-mono sb:text-xs sb:text-zinc-500">
                        {tk.prefix}…
                      </span>
                      <span className="sb:block sb:text-xs sb:text-zinc-500">
                        {a.actions(tk.actions_30d)}
                      </span>
                    </td>
                    <td className={`${td} sb:text-xs`}>
                      {tk.scopes.map((s) => a.scopeNames[s] ?? s).join(', ')}
                    </td>
                    <td className={`${td} sb:text-zinc-500`}>
                      {tk.last_used_at ? date(tk.last_used_at) : a.never}
                    </td>
                    <td className={`${td} sb:text-right`}>
                      {!tk.revoked_at &&
                        (revoking === tk.id ? (
                          <Button
                            variant="danger"
                            className="sb:px-2 sb:py-1"
                            onClick={() => revoke.mutate(tk.id)}
                          >
                            {a.confirmRevoke}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            className="sb:px-2 sb:py-1"
                            onClick={() => setRevoking(tk.id)}
                          >
                            {a.revoke}
                          </Button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
        <Card
          title={a.activity}
          actions={
            (tokens.data?.data.length ?? 0) > 1 && (
              <div className="sb:w-48">
                <Select
                  aria-label={a.activity}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">{a.filterAll}</option>
                  {tokens.data?.data.map((tk) => (
                    <option key={tk.id} value={tk.id}>
                      {tk.name}
                    </option>
                  ))}
                </Select>
              </div>
            )
          }
        >
          <ErrorAlert error={activity.error} />
          {activity.data && entries.length === 0 && (
            <p className="sb:text-sm sb:text-zinc-500">{a.activityEmpty}</p>
          )}
          <ul className="sb:divide-y sb:divide-zinc-100 sb:text-sm" data-testid="agent-activity">
            {entries.map((e) => (
              <li
                key={e.id}
                className="sb:flex sb:flex-wrap sb:items-baseline sb:justify-between sb:gap-2 sb:py-2"
              >
                <span>
                  <span className="sb:font-medium">{e.actor_name ?? e.actor_id}</span>{' '}
                  <span className="sb:font-mono sb:text-xs">{e.action}</span>{' '}
                  {e.entity_id && e.entity === 'order' ? (
                    <Link to={`/orders/${e.entity_id}`} className="sb:text-xs sb:underline">
                      {e.entity}
                    </Link>
                  ) : e.entity_id && e.entity === 'product' ? (
                    <Link to={`/products/${e.entity_id}`} className="sb:text-xs sb:underline">
                      {e.entity}
                    </Link>
                  ) : (
                    <span className="sb:text-xs sb:text-zinc-500">{e.entity}</span>
                  )}
                </span>
                <span className="sb:text-xs sb:text-zinc-500">{date(e.created_at)}</span>
              </li>
            ))}
          </ul>
          {activity.hasNextPage && (
            <Button
              variant="outline"
              className="sb:mt-3"
              onClick={() => void activity.fetchNextPage()}
            >
              {a.loadMore}
            </Button>
          )}
        </Card>
      </div>
    </>
  );
}

// ── Webhooks ────────────────────────────────────────────────────────────────

type Endpoint = Awaited<ReturnType<Sellbase['admin']['webhooks']['list']>>['data'][number];

const STATUS_TONES = { pending: 'amber', succeeded: 'green', failed: 'red' } as const;

export function WebhooksPage() {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const w = t.webhooks;
  const hooks = useQuery({
    queryKey: ['sellbase-admin', 'webhooks'],
    queryFn: () => sellbase.admin.webhooks.list(),
  });
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      sellbase.admin.webhooks.create({
        url,
        description,
        events: events as Parameters<Sellbase['admin']['webhooks']['create']>[0]['events'],
      }),
    onSuccess: () => {
      setUrl('');
      setDescription('');
      setEvents([]);
      void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'webhooks'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageTitle>{t.settings.title}</PageTitle>
      <SettingsTabs />
      <div className="sb:flex sb:flex-col sb:gap-6">
        <p className="sb:text-sm sb:text-zinc-600">{w.intro}</p>
        <Card>
          <form onSubmit={submit} className="sb:flex sb:flex-col sb:gap-4">
            <div className="sb:grid sb:gap-3 sb:md:grid-cols-2">
              <Field label={w.url}>
                <Input
                  type="url"
                  required
                  placeholder="https://"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field label={w.description}>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
            <fieldset>
              <legend className="sb:mb-2 sb:text-sm sb:font-medium sb:text-zinc-700">
                {w.events}{' '}
                <span className="sb:font-normal sb:text-zinc-500">{w.allEventsHint}</span>
              </legend>
              <div className="sb:grid sb:gap-2 sb:sm:grid-cols-2 sb:lg:grid-cols-3">
                {hooks.data?.events.map((ev) => (
                  <label
                    key={ev}
                    className="sb:flex sb:items-center sb:gap-2 sb:font-mono sb:text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={events.includes(ev)}
                      onChange={(e) =>
                        setEvents(
                          e.target.checked ? [...events, ev] : events.filter((x) => x !== ev),
                        )
                      }
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorAlert error={create.error} />
            {create.data && (
              <div className="sb:flex sb:flex-col sb:gap-2" data-testid="webhook-secret">
                <Alert tone="green">{w.secretNow}</Alert>
                <Input
                  readOnly
                  value={create.data.secret}
                  onFocus={(e) => e.target.select()}
                  className="sb:font-mono"
                />
                <p className="sb:text-xs sb:text-zinc-500">{w.verifyHint}</p>
              </div>
            )}
            <div>
              <Button type="submit" disabled={!url || create.isPending}>
                {w.create}
              </Button>
            </div>
          </form>
        </Card>
        {hooks.isLoading && <Spinner label={t.common.loading} />}
        <ErrorAlert error={hooks.error} />
        {hooks.data?.data.length === 0 && <p className="sb:text-sm sb:text-zinc-500">{w.empty}</p>}
        {hooks.data?.data.map((endpoint) => (
          <EndpointCard key={endpoint.id} endpoint={endpoint} />
        ))}
      </div>
    </>
  );
}

function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const date = useDateTime();
  const w = t.webhooks;
  const [confirming, setConfirming] = useState(false);
  const deliveries = useQuery({
    queryKey: ['sellbase-admin', 'webhooks', endpoint.id, 'deliveries'],
    queryFn: () => sellbase.admin.webhooks.deliveries(endpoint.id),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'webhooks'] });
  const toggle = useMutation({
    mutationFn: () => sellbase.admin.webhooks.update(endpoint.id, { enabled: !endpoint.enabled }),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: () => sellbase.admin.webhooks.test(endpoint.id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => sellbase.admin.webhooks.delete(endpoint.id),
    onSuccess: refresh,
  });

  return (
    <div data-testid="webhook-endpoint">
      <Card
        title={
          <span className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
            <span className="sb:break-all sb:font-mono sb:text-sm">{endpoint.url}</span>
            <Badge tone={endpoint.enabled ? 'green' : 'neutral'}>
              {endpoint.enabled ? w.enabled : w.paused}
            </Badge>
            {endpoint.stats.failed > 0 && (
              <Badge tone="red">{w.failedCount(endpoint.stats.failed)}</Badge>
            )}
          </span>
        }
      >
        <div className="sb:flex sb:flex-col sb:gap-3">
          <p className="sb:text-xs sb:text-zinc-500">
            {endpoint.description ? `${endpoint.description} · ` : ''}
            {endpoint.events.length ? endpoint.events.join(', ') : w.allEvents} ·{' '}
            <span className="sb:font-mono">{endpoint.secret_prefix}…</span>
          </p>
          <div className="sb:flex sb:flex-wrap sb:gap-2">
            <Button
              variant="outline"
              className="sb:px-3 sb:py-1"
              onClick={() => test.mutate()}
              disabled={test.isPending}
            >
              {w.test}
            </Button>
            <Button variant="outline" className="sb:px-3 sb:py-1" onClick={() => toggle.mutate()}>
              {endpoint.enabled ? w.pause : w.resume}
            </Button>
            {confirming ? (
              <Button variant="danger" className="sb:px-3 sb:py-1" onClick={() => remove.mutate()}>
                {w.confirmRemove}
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="sb:px-3 sb:py-1 sb:text-red-700"
                onClick={() => setConfirming(true)}
              >
                {w.remove}
              </Button>
            )}
          </div>
          <ErrorAlert error={test.error ?? toggle.error ?? remove.error} />
          <p className="sb:text-sm sb:font-medium">{w.deliveries}</p>
          {deliveries.data?.data.length === 0 && (
            <p className="sb:text-sm sb:text-zinc-500">{w.noDeliveries}</p>
          )}
          <ul className="sb:divide-y sb:divide-zinc-100 sb:text-sm">
            {deliveries.data?.data.slice(0, 10).map((d) => (
              <li
                key={d.id}
                className="sb:flex sb:flex-wrap sb:items-center sb:justify-between sb:gap-2 sb:py-2"
                data-testid="webhook-delivery"
              >
                <span className="sb:font-mono sb:text-xs">{d.event_type}</span>
                <span className="sb:flex sb:items-center sb:gap-2 sb:text-xs sb:text-zinc-500">
                  {d.last_status_code ? `HTTP ${d.last_status_code} · ` : ''}
                  {w.attempts(d.attempts)} · {date(d.created_at)}
                  <Badge tone={STATUS_TONES[d.status]}>{w.statuses[d.status] ?? d.status}</Badge>
                </span>
                {d.last_error && d.status !== 'succeeded' && (
                  <span className="sb:w-full sb:text-xs sb:text-red-700">{d.last_error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
