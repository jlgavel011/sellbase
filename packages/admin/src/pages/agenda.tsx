import type { Sellbase } from '@sellbase/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAdmin } from '../context.js';
import { Link } from '../router.js';
import { Page } from '../shell.js';
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
  type Tone,
  buttonClass,
} from '../ui.js';

type Booking = Awaited<ReturnType<Sellbase['admin']['bookings']['search']>>['data'][number];

const TONES: Record<string, Tone> = {
  confirmed: 'blue',
  completed: 'green',
  no_show: 'amber',
  cancelled: 'red',
  rescheduled: 'neutral',
};
const DAY = 86_400_000;

/** Monday 00:00 (browser time) of the week containing `d`. */
function weekStart(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function AgendaPage() {
  const { sellbase, t, config } = useAdmin();
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [resource, setResource] = useState('');
  const end = new Date(start.getTime() + 7 * DAY);
  const resources = useQuery({
    queryKey: ['sellbase-admin', 'resources'],
    queryFn: () => sellbase.admin.resources.list(),
  });
  const bookings = useQuery({
    queryKey: ['sellbase-admin', 'bookings', start.toISOString(), resource],
    queryFn: () =>
      sellbase.admin.bookings.search({
        from: start.toISOString(),
        to: end.toISOString(),
        ...(resource ? { resource_id: resource } : {}),
      }),
  });

  const days = useMemo(() => {
    const groups = new Map<string, Booking[]>();
    for (const b of bookings.data?.data ?? []) {
      const key = new Intl.DateTimeFormat(locale, {
        timeZone: b.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date(b.starts_at));
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
    return [...groups.entries()];
  }, [bookings.data, locale]);

  return (
    <Page
      title={t.agenda.title}
      width="wide"
      actions={
        <Link to="/agenda/resources" className={buttonClass('secondary')}>
          {t.agenda.resources}
        </Link>
      }
    >
      <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
        <Button variant="outline" onClick={() => setStart(new Date(start.getTime() - 7 * DAY))}>
          {t.agenda.previous}
        </Button>
        <Button variant="ghost" onClick={() => setStart(weekStart(new Date()))}>
          {t.agenda.today}
        </Button>
        <Button variant="outline" onClick={() => setStart(new Date(start.getTime() + 7 * DAY))}>
          {t.agenda.next}
        </Button>
        <span className="sb:text-[var(--sba-text-subdued)]">
          {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(start)} –{' '}
          {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
            new Date(end.getTime() - DAY),
          )}
        </span>
        {(resources.data?.data.length ?? 0) > 1 && (
          <div className="sb:ml-auto sb:w-48">
            <Select
              aria-label={t.resources.title}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">{t.agenda.allResources}</option>
              {resources.data?.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {bookings.isLoading && <Spinner label={t.common.loading} />}
      <ErrorAlert error={bookings.error} />
      {bookings.data && days.length === 0 && (
        <Card>
          <EmptyState
            title={t.agenda.empty}
            prompt={t.agenda.emptyPrompt}
            askAi={t.home.askAi}
            copy={t.home.copy}
            copied={t.home.copied}
          />
        </Card>
      )}
      <div className="sb:flex sb:flex-col sb:gap-4">
        {days.map(([day, list]) => (
          <Card
            key={day}
            title={<span className="sb:inline-block sb:first-letter:uppercase">{day}</span>}
          >
            <ul className="sb:divide-y sb:divide-[var(--sba-border)]">
              {list.map((b) => (
                <BookingRow key={b.id} booking={b} locale={locale} />
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </Page>
  );
}

function BookingRow({ booking, locale }: { booking: Booking; locale: string }) {
  const { sellbase, t } = useAdmin();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<null | 'cancel' | 'reschedule'>(null);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: booking.timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['sellbase-admin', 'bookings'] });
    setPanel(null);
    setConfirming(false);
  };
  const complete = useMutation({
    mutationFn: () => sellbase.admin.bookings.complete(booking.id),
    onSuccess: done,
  });
  const noShow = useMutation({
    mutationFn: () => sellbase.admin.bookings.noShow(booking.id),
    onSuccess: done,
  });
  const cancel = useMutation({
    mutationFn: () => sellbase.admin.bookings.cancel(booking.id, { reason, refund, confirm: true }),
    onSuccess: done,
  });
  const reschedule = useMutation({
    mutationFn: (startsAt: string) =>
      sellbase.admin.bookings.reschedule(booking.id, { starts_at: startsAt }),
    onSuccess: done,
  });
  const slots = useQuery({
    queryKey: ['sellbase-admin', 'reschedule-slots', booking.variant_id],
    queryFn: () => sellbase.availability.get(booking.variant_id ?? ''),
    enabled: panel === 'reschedule' && Boolean(booking.variant_id),
  });
  const active = booking.status === 'confirmed';
  const error = complete.error ?? noShow.error ?? cancel.error ?? reschedule.error;

  return (
    <li className="sb:flex sb:flex-col sb:gap-2 sb:py-3" data-testid="booking-row">
      <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-x-4 sb:gap-y-1">
        <span className="sb:w-28 sb:font-medium">
          {time(booking.starts_at)}–{time(booking.ends_at)}
        </span>
        <span className="sb:flex-1">
          {booking.product?.title ?? '—'} · {booking.resource.name}
          <span className="sb:block sb:text-[var(--sba-text-subdued)]">
            {booking.email ?? ''}
            {booking.order && (
              <>
                {' '}
                ·{' '}
                <Link to={`/orders/${booking.order.id}`} className="sb:underline">
                  #{booking.order.number}
                </Link>
              </>
            )}
          </span>
        </span>
        <Badge tone={TONES[booking.status] ?? 'neutral'}>
          {t.agenda.statuses[booking.status] ?? booking.status}
        </Badge>
      </div>
      {active && (
        <div className="sb:flex sb:flex-wrap sb:gap-2">
          <Button
            variant="outline"
            className="sb:px-3 sb:py-1"
            onClick={() => complete.mutate()}
            disabled={complete.isPending}
          >
            {t.agenda.complete}
          </Button>
          <Button
            variant="outline"
            className="sb:px-3 sb:py-1"
            onClick={() => noShow.mutate()}
            disabled={noShow.isPending}
          >
            {t.agenda.noShow}
          </Button>
          <Button
            variant="ghost"
            className="sb:px-3 sb:py-1"
            onClick={() => setPanel(panel === 'reschedule' ? null : 'reschedule')}
          >
            {t.agenda.reschedule}
          </Button>
          <Button
            variant="ghost"
            className="sb:px-3 sb:py-1 sb:text-red-700"
            onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}
          >
            {t.agenda.cancel}
          </Button>
        </div>
      )}
      {panel === 'reschedule' && (
        <div className="sb:flex sb:flex-col sb:gap-2">
          <p className="sb:text-sm sb:font-medium">{t.agenda.pickTime}</p>
          {slots.isLoading && <Spinner label={t.common.loading} />}
          {slots.data && slots.data.slots.length === 0 && (
            <p className="sb:text-[var(--sba-text-subdued)]">{t.agenda.noSlots}</p>
          )}
          <div className="sb:flex sb:flex-wrap sb:gap-2">
            {slots.data?.slots.slice(0, 24).map((s) => (
              <Button
                key={s.starts_at}
                variant="outline"
                className="sb:px-2 sb:py-1 sb:text-xs"
                onClick={() => reschedule.mutate(s.starts_at)}
                disabled={reschedule.isPending}
              >
                {new Intl.DateTimeFormat(locale, {
                  timeZone: slots.data?.timezone,
                  weekday: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(new Date(s.starts_at))}
              </Button>
            ))}
          </div>
        </div>
      )}
      {panel === 'cancel' && (
        <div className="sb:flex sb:flex-col sb:gap-2">
          <Field label={t.agenda.reason}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {booking.order && (
            <label className="sb:flex sb:items-center sb:gap-2 sb:text-sm">
              <input
                type="checkbox"
                className="sba-checkbox"
                checked={refund}
                onChange={(e) => setRefund(e.target.checked)}
              />
              {t.agenda.refund}
            </label>
          )}
          {!confirming ? (
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={!reason}>
              {t.agenda.cancel}
            </Button>
          ) : (
            <>
              <Alert tone="amber">{t.agenda.cancelImpact}</Alert>
              <div className="sb:flex sb:gap-2">
                <Button
                  variant="danger"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {t.agenda.confirm}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  {t.agenda.back}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <ErrorAlert error={error} />
    </li>
  );
}
