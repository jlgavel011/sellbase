'use client';

/*
 * Sellbase · booking-picker
 * Lets the buyer pick a day and a time for a service. Times come from the API and are
 * shown in the store's time zone (not the visitor's), with the zone name visible.
 * Props: `variantId`, `onSelect(slot)`, optional `days` (how far ahead, default 14).
 * AI: restyle days/times as chips, a calendar or a list; keep showing the time zone and
 * never invent times: only offer what the API returns.
 */
import { useAvailability } from '@sellbase/react';
import { useMemo, useState } from 'react';

export interface PickedSlot {
  starts_at: string;
  resource_id?: string;
}

export function BookingPicker({
  variantId,
  onSelect,
  days = 14,
  locale = 'es-MX',
}: {
  variantId: string;
  onSelect: (slot: PickedSlot | null) => void;
  days?: number;
  locale?: string;
}) {
  const range = useMemo(
    () => ({ to: new Date(Date.now() + days * 86_400_000).toISOString() }),
    [days],
  );
  const { data, isLoading, error } = useAvailability(variantId, range);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [resource, setResource] = useState<string>('');

  const tz = data?.timezone ?? 'UTC';
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  const slots = (data?.slots ?? []).filter((s) => !resource || s.resource_ids.includes(resource));
  const byDay = new Map<string, typeof slots>();
  for (const slot of slots)
    byDay.set(dayKey(slot.starts_at), [...(byDay.get(dayKey(slot.starts_at)) ?? []), slot]);
  const dayList = [...byDay.keys()];
  const activeDay = day && byDay.has(day) ? day : (dayList[0] ?? null);
  const zoneName = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'long' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;

  const choose = (iso: string | null) => {
    setPicked(iso);
    onSelect(iso ? { starts_at: iso, ...(resource ? { resource_id: resource } : {}) } : null);
  };

  if (isLoading)
    return (
      <div
        className="h-32 animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
        aria-busy="true"
      />
    );
  if (error)
    return (
      <p role="alert" className="text-sm text-[var(--sb-danger)]">
        No pudimos cargar los horarios.
      </p>
    );
  if (!dayList.length)
    return <p className="text-sm text-[var(--sb-muted)]">No hay horarios disponibles por ahora.</p>;

  return (
    <div className="flex flex-col gap-4" aria-label="Elige fecha y hora">
      {(data?.resources.length ?? 0) > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          ¿Con quién?
          <select
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              choose(null);
            }}
            className="rounded-md border border-[var(--sb-border)] px-3 py-2"
          >
            <option value="">Cualquiera</option>
            {data?.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Días">
        {dayList.map((key) => {
          const first = byDay.get(key)?.[0]?.starts_at ?? '';
          const label = new Intl.DateTimeFormat(locale, {
            timeZone: tz,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).format(new Date(first));
          const active = key === activeDay;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setDay(key);
                choose(null);
              }}
              className={`shrink-0 rounded-[var(--sb-radius)] border px-3 py-2 text-sm first-letter:uppercase ${active ? 'border-[var(--sb-primary)] bg-[var(--sb-primary)] text-[var(--sb-primary-fg)]' : 'border-[var(--sb-border)]'}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        role="radiogroup"
        aria-label="Horarios"
      >
        {(activeDay ? (byDay.get(activeDay) ?? []) : []).map((slot) => {
          const time = new Intl.DateTimeFormat(locale, {
            timeZone: tz,
            hour: 'numeric',
            minute: '2-digit',
          }).format(new Date(slot.starts_at));
          const active = picked === slot.starts_at;
          return (
            <button
              key={slot.starts_at}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(slot.starts_at)}
              className={`rounded-md border px-2 py-2 text-sm ${active ? 'border-[var(--sb-primary)] bg-[var(--sb-primary)] text-[var(--sb-primary-fg)]' : 'border-[var(--sb-border)]'}`}
            >
              {time}
            </button>
          );
        })}
      </div>
      {zoneName && <p className="text-xs text-[var(--sb-muted)]">Horarios en {zoneName}.</p>}
    </div>
  );
}
