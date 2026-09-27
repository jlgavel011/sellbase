import type { Sellbase } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { PageTitle } from '../shell.js';
import { Alert, Button, Card, ErrorAlert, Field, Input, Select, Spinner } from '../ui.js';

type Resource = Awaited<ReturnType<Sellbase['admin']['resources']['list']>>['data'][number];
interface DayHours {
  open: boolean;
  start: string;
  end: string;
}

const defaultWeek = (): DayHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d >= 1 && d <= 5, start: '09:00', end: '18:00' }));

/** Resources (people, rooms, equipment) with weekly hours, services and exceptions. */
export function ResourcesPage() {
  const { sellbase, t } = useAdmin();
  const resources = useQuery({
    queryKey: ['sellbase-admin', 'resources'],
    queryFn: () => sellbase.admin.resources.list(),
  });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const current = resources.data?.data.find((r) => r.id === selected) ?? null;
  const first = resources.data?.data[0]?.id;
  useEffect(() => {
    if (selected === null && first) setSelected(first);
  }, [first, selected]);

  return (
    <>
      <Link to="/agenda" className="sb:text-sm sb:text-zinc-500 sb:hover:underline">
        {t.resources.back}
      </Link>
      <PageTitle actions={<Button onClick={() => setSelected('new')}>{t.resources.new}</Button>}>
        {t.resources.title}
      </PageTitle>
      {resources.isLoading && <Spinner label={t.common.loading} />}
      <ErrorAlert error={resources.error} />
      <div className="sb:grid sb:gap-6 sb:md:grid-cols-[14rem_1fr]">
        <nav className="sb:flex sb:flex-col sb:gap-1" aria-label={t.resources.title}>
          {resources.data?.data.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              className={`sb:rounded-[var(--sba-radius)] sb:px-3 sb:py-2 sb:text-left sb:text-sm ${selected === r.id ? 'sb:bg-white sb:font-medium sb:shadow-sm' : 'sb:hover:bg-white'} ${r.active ? '' : 'sb:text-zinc-400'}`}
            >
              {r.name}
              <span className="sb:block sb:text-xs sb:text-zinc-500">
                {t.resources.kinds[r.kind] ?? r.kind}
              </span>
            </button>
          ))}
        </nav>
        {(selected === 'new' || current) && (
          <ResourceForm
            key={selected ?? 'none'}
            resource={current}
            onSaved={(id) => setSelected(id)}
          />
        )}
      </div>
    </>
  );
}

function ResourceForm({
  resource,
  onSaved,
}: {
  resource: Resource | null;
  onSaved: (id: string) => void;
}) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
  const services = useQuery({
    queryKey: ['sellbase-admin', 'products', 'services'],
    queryFn: () => sellbase.admin.products.search({ type: 'service', limit: 100 }),
  });
  const [name, setName] = useState(resource?.name ?? '');
  const [kind, setKind] = useState<'staff' | 'room' | 'equipment'>(resource?.kind ?? 'staff');
  const [timezone, setTimezone] = useState(resource?.timezone ?? '');
  const [week, setWeek] = useState<DayHours[]>(() => {
    if (!resource) return defaultWeek();
    return [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const rule = resource.rules.find((r) => r.weekday === d);
      return rule
        ? { open: true, start: rule.start_time, end: rule.end_time }
        : { open: false, start: '09:00', end: '18:00' };
    });
  });
  const [productIds, setProductIds] = useState<string[]>(resource?.product_ids ?? []);
  const [exFrom, setExFrom] = useState('');
  const [exTo, setExTo] = useState('');
  const [exKind, setExKind] = useState<'closed' | 'open'>('closed');

  const refresh = () => void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'resources'] });
  const save = useMutation({
    mutationFn: () =>
      sellbase.admin.resources.upsert({
        ...(resource ? { id: resource.id } : {}),
        name,
        kind,
        ...(timezone || store.data ? { timezone: timezone || store.data?.timezone } : {}),
        rules: week.flatMap((d, weekday) =>
          d.open ? [{ weekday, start_time: d.start, end_time: d.end }] : [],
        ),
        product_ids: productIds,
      }),
    onSuccess: (r) => {
      refresh();
      onSaved(r.id);
    },
  });
  const addException = useMutation({
    mutationFn: () =>
      sellbase.admin.resources.addException(resource?.id ?? '', {
        starts_at: new Date(exFrom).toISOString(),
        ends_at: new Date(exTo).toISOString(),
        kind: exKind,
      }),
    onSuccess: () => {
      setExFrom('');
      setExTo('');
      refresh();
    },
  });
  const removeException = useMutation({
    mutationFn: (id: string) => sellbase.admin.resources.removeException(resource?.id ?? '', id),
    onSuccess: refresh,
  });
  const setDay = (i: number, patch: Partial<DayHours>) =>
    setWeek(week.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="sb:flex sb:flex-col sb:gap-6">
      <Card>
        <div className="sb:grid sb:gap-4 sb:md:grid-cols-3">
          <Field label={t.resources.name}>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t.resources.kind}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {Object.entries(t.resources.kinds).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.resources.timezone}>
            <Input
              value={timezone}
              placeholder={store.data?.timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title={t.resources.hours}>
        <div className="sb:flex sb:flex-col sb:gap-2">
          {week.map((d, i) => (
            <div
              key={i}
              className="sb:grid sb:grid-cols-[7rem_auto_1fr_1fr] sb:items-center sb:gap-3 sb:text-sm"
            >
              <span>{t.resources.weekdays[i]}</span>
              <input
                type="checkbox"
                aria-label={t.resources.weekdays[i]}
                checked={d.open}
                onChange={(e) => setDay(i, { open: e.target.checked })}
              />
              {d.open ? (
                <>
                  <Input
                    type="time"
                    aria-label={`${t.resources.weekdays[i]} ${t.resources.from}`}
                    value={d.start}
                    onChange={(e) => setDay(i, { start: e.target.value })}
                  />
                  <Input
                    type="time"
                    aria-label={`${t.resources.weekdays[i]} ${t.resources.to}`}
                    value={d.end}
                    onChange={(e) => setDay(i, { end: e.target.value })}
                  />
                </>
              ) : (
                <span className="sb:col-span-2 sb:text-zinc-400">{t.resources.closed}</span>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card title={t.resources.services}>
        {services.data && services.data.data.length === 0 && (
          <p className="sb:text-sm sb:text-zinc-500">{t.resources.noServices}</p>
        )}
        <div className="sb:flex sb:flex-col sb:gap-2">
          {services.data?.data.map((p) => (
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
            </label>
          ))}
        </div>
      </Card>

      <ErrorAlert error={save.error} />
      {save.isSuccess && <Alert tone="green">{t.resources.saved}</Alert>}
      <div>
        <Button onClick={() => save.mutate()} disabled={!name || save.isPending}>
          {t.resources.save}
        </Button>
      </div>

      {resource && (
        <Card title={t.resources.exceptions}>
          <p className="sb:mb-3 sb:text-xs sb:text-zinc-500">{t.resources.exceptionHint}</p>
          <ul className="sb:mb-4 sb:flex sb:flex-col sb:gap-2 sb:text-sm">
            {resource.exceptions.map((x) => (
              <li key={x.id} className="sb:flex sb:items-center sb:justify-between sb:gap-2">
                <span>
                  {x.kind === 'closed' ? t.resources.blocked : t.resources.extra}:{' '}
                  {new Date(x.starts_at).toLocaleString()} – {new Date(x.ends_at).toLocaleString()}
                </span>
                <Button
                  variant="ghost"
                  className="sb:px-2 sb:py-1"
                  onClick={() => removeException.mutate(x.id)}
                >
                  {t.resources.remove}
                </Button>
              </li>
            ))}
          </ul>
          <div className="sb:grid sb:gap-3 sb:md:grid-cols-4">
            <Field label={t.resources.from}>
              <Input
                type="datetime-local"
                value={exFrom}
                onChange={(e) => setExFrom(e.target.value)}
              />
            </Field>
            <Field label={t.resources.to}>
              <Input type="datetime-local" value={exTo} onChange={(e) => setExTo(e.target.value)} />
            </Field>
            <Field label={t.resources.kind}>
              <Select
                value={exKind}
                onChange={(e) => setExKind(e.target.value as 'closed' | 'open')}
              >
                <option value="closed">{t.resources.blocked}</option>
                <option value="open">{t.resources.extra}</option>
              </Select>
            </Field>
            <div className="sb:self-end">
              <Button
                variant="outline"
                onClick={() => addException.mutate()}
                disabled={!exFrom || !exTo || addException.isPending}
              >
                {t.resources.add}
              </Button>
            </div>
          </div>
          <ErrorAlert error={addException.error ?? removeException.error} />
        </Card>
      )}
    </div>
  );
}
