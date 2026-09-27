import { sellbaseError } from './errors.js';

/**
 * Bookable slots for services (SPEC §5.2, §16). Pure: the API loads rules, exceptions and
 * existing bookings; this decides which start times are free.
 *
 * - Opening hours are wall-clock times in the resource's IANA time zone; slots are real
 *   instants, so daylight-saving changes shorten or lengthen the day correctly and
 *   nonexistent local times (spring-forward gap) are never offered.
 * - A booking occupies [start − buffer_before, start + duration + buffer_after).
 * - A resource with capacity N can overlap N bookings (group classes).
 */

export interface AvailabilityRule {
  /** 0 = Sunday … 6 = Saturday, in the rule's time zone. */
  weekday: number;
  /** 'HH:MM' local wall time. */
  start_time: string;
  end_time: string;
  timezone?: string | null;
}

export interface AvailabilityException {
  starts_at: Date;
  ends_at: Date;
  /** closed: time off; open: extra hours outside the weekly rules. */
  kind: 'closed' | 'open';
}

export interface BusyRange {
  /** Occupied range, buffers included. */
  starts_at: Date;
  ends_at: Date;
}

export interface ResourceSchedule {
  id: string;
  timezone: string;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
  busy: BusyRange[];
}

export interface ServiceTiming {
  duration_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  capacity: number;
  min_notice_min: number;
  booking_window_days: number;
  /** Minutes between candidate start times. Defaults to the duration, capped at 60. */
  slot_interval_min?: number | null;
}

export interface Slot {
  starts_at: Date;
  ends_at: Date;
  /** Resources that can take this slot, least busy first. */
  resource_ids: string[];
  /** Seats left across those resources. */
  remaining: number;
}

const MIN = 60_000;
const DAY = 86_400_000;

// ── Time zones (Intl only, no dependencies) ──────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      throw sellbaseError(
        'VALIDATION_ERROR',
        `Unknown time zone "${tz}".`,
        'Use an IANA time zone such as America/Mexico_City.',
        { timezone: tz },
      );
    }
    formatters.set(tz, f);
  }
  return f;
}

export function isTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in a time zone. */
export function wallTime(instant: Date, tz: string): WallTime {
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const n = (key: string) => Number(parts[key] ?? Number.NaN);
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
  };
}

function offsetMs(instant: Date, tz: string): number {
  const w = wallTime(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(instant.getTime() / MIN) * MIN;
}

/**
 * The instant a wall-clock time happens in a time zone. Returns null for times that do
 * not exist (spring-forward gap). Ambiguous times (fall-back) resolve to the first one.
 */
export function zonedTimeToInstant(w: WallTime, tz: string): Date | null {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  const candidates = new Set([guess - offsetMs(new Date(guess), tz)]);
  for (const c of [...candidates]) candidates.add(guess - offsetMs(new Date(c), tz));
  // Also try the offsets one hour around, to find the earlier of two ambiguous instants.
  candidates.add(guess - offsetMs(new Date(guess - 2 * 3_600_000), tz));
  const valid = [...candidates]
    .map((ms) => new Date(ms))
    .filter((d) => {
      const back = wallTime(d, tz);
      return (
        back.year === w.year &&
        back.month === w.month &&
        back.day === w.day &&
        back.hour === w.hour &&
        back.minute === w.minute
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return valid[0] ?? null;
}

function parseTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const hour = Number(m?.[1]);
  const minute = Number(m?.[2]);
  if (!m || hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw sellbaseError(
      'VALIDATION_ERROR',
      `"${value}" is not a valid time.`,
      'Use 24-hour HH:MM, e.g. 09:00 or 18:30.',
    );
  }
  return { hour, minute };
}

// ── Windows ──────────────────────────────────────────────────────────────────

interface Range {
  start: number;
  end: number;
}

function subtract(ranges: Range[], cut: Range): Range[] {
  return ranges.flatMap((r) => {
    if (cut.end <= r.start || cut.start >= r.end) return [r];
    const out: Range[] = [];
    if (cut.start > r.start) out.push({ start: r.start, end: cut.start });
    if (cut.end < r.end) out.push({ start: cut.end, end: r.end });
    return out;
  });
}

/** Opening windows of a resource between two instants, as absolute ranges. */
export function openWindows(
  resource: Pick<ResourceSchedule, 'timezone' | 'rules' | 'exceptions'>,
  from: Date,
  to: Date,
): Range[] {
  let windows: Range[] = [];
  const byTz = new Map<string, AvailabilityRule[]>();
  for (const rule of resource.rules) {
    const tz = rule.timezone ?? resource.timezone;
    byTz.set(tz, [...(byTz.get(tz) ?? []), rule]);
  }
  for (const [tz, rules] of byTz) {
    const first = wallTime(new Date(from.getTime() - DAY), tz);
    const last = wallTime(new Date(to.getTime() + DAY), tz);
    for (
      let day = Date.UTC(first.year, first.month - 1, first.day);
      day <= Date.UTC(last.year, last.month - 1, last.day);
      day += DAY
    ) {
      const date = new Date(day);
      const weekday = date.getUTCDay();
      const ymd = {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      };
      for (const rule of rules.filter((r) => r.weekday === weekday)) {
        const s = parseTime(rule.start_time);
        const e = parseTime(rule.end_time);
        const start =
          zonedTimeToInstant({ ...ymd, ...s }, tz) ??
          zonedTimeToInstant({ ...ymd, hour: s.hour + 1, minute: 0 }, tz);
        const endWall = e.hour === 24 ? { ...ymd, hour: 23, minute: 59 } : { ...ymd, ...e };
        let end =
          zonedTimeToInstant(endWall, tz) ??
          zonedTimeToInstant({ ...ymd, hour: e.hour + 1, minute: 0 }, tz);
        if (end && e.hour === 24) end = new Date(end.getTime() + MIN);
        if (start && end && end > start)
          windows.push({ start: start.getTime(), end: end.getTime() });
      }
    }
  }
  for (const ex of resource.exceptions) {
    const range = { start: ex.starts_at.getTime(), end: ex.ends_at.getTime() };
    if (ex.kind === 'open') windows.push(range);
  }
  for (const ex of resource.exceptions.filter((x) => x.kind === 'closed')) {
    windows = subtract(windows, { start: ex.starts_at.getTime(), end: ex.ends_at.getTime() });
  }
  // Keep each window's real start: the slot grid aligns to it (09:00, 10:00…). The
  // requested range only filters candidates, it never shifts them.
  return windows.filter((w) => w.end > from.getTime() && w.start < to.getTime() + DAY);
}

// ── Slots ────────────────────────────────────────────────────────────────────

export function occupiedRange(
  start: Date,
  service: Pick<ServiceTiming, 'duration_min' | 'buffer_before_min' | 'buffer_after_min'>,
) {
  return {
    starts_at: new Date(start.getTime() - service.buffer_before_min * MIN),
    ends_at: new Date(start.getTime() + (service.duration_min + service.buffer_after_min) * MIN),
  };
}

export function computeSlots(input: {
  now: Date;
  from: Date;
  to: Date;
  service: ServiceTiming;
  resources: ResourceSchedule[];
}): Slot[] {
  const { service, now } = input;
  if (service.duration_min <= 0) throw new RangeError('duration_min must be positive');
  const interval = (service.slot_interval_min ?? Math.min(service.duration_min, 60)) * MIN;
  const duration = service.duration_min * MIN;
  const earliest = Math.max(input.from.getTime(), now.getTime() + service.min_notice_min * MIN);
  const latest = Math.min(input.to.getTime(), now.getTime() + service.booking_window_days * DAY);
  const byStart = new Map<number, { resources: { id: string; remaining: number }[] }>();

  for (const resource of input.resources) {
    const busy = resource.busy.map((b) => ({
      start: b.starts_at.getTime(),
      end: b.ends_at.getTime(),
    }));
    for (const window of openWindows(resource, input.from, input.to)) {
      // Align candidates to the interval from the window start (e.g. 09:00, 09:30…).
      for (let t = window.start; t + duration <= window.end; t += interval) {
        if (t < earliest || t >= latest) continue;
        const occ = occupiedRange(new Date(t), service);
        const overlapping = busy.filter(
          (b) => b.start < occ.ends_at.getTime() && b.end > occ.starts_at.getTime(),
        ).length;
        const remaining = service.capacity - overlapping;
        if (remaining <= 0) continue;
        const entry = byStart.get(t) ?? { resources: [] };
        entry.resources.push({ id: resource.id, remaining });
        byStart.set(t, entry);
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, e]) => ({
      starts_at: new Date(t),
      ends_at: new Date(t + duration),
      resource_ids: [...e.resources].sort((a, b) => b.remaining - a.remaining).map((r) => r.id),
      remaining: e.resources.reduce((n, r) => n + r.remaining, 0),
    }));
}

/** Whether a specific start time is currently bookable (used before holding a slot). */
export function isSlotAvailable(
  slots: readonly Slot[],
  startsAt: Date,
  resourceId?: string | null,
): boolean {
  return slots.some(
    (s) =>
      s.starts_at.getTime() === startsAt.getTime() &&
      (!resourceId || s.resource_ids.includes(resourceId)),
  );
}
