import { describe, expect, it } from 'vitest';
import {
  computeSlots,
  isSellbaseError,
  isSlotAvailable,
  isTimeZone,
  occupiedRange,
  wallTime,
  zonedTimeToInstant,
  type ResourceSchedule,
  type ServiceTiming,
} from '../src/index.js';

const CDMX = 'America/Mexico_City'; // UTC−6, no DST since 2022
const NY = 'America/New_York';

const service = (over: Partial<ServiceTiming> = {}): ServiceTiming => ({
  duration_min: 60,
  buffer_before_min: 0,
  buffer_after_min: 0,
  capacity: 1,
  min_notice_min: 0,
  booking_window_days: 60,
  ...over,
});

const weekdays = (start = '09:00', end = '14:00') =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: start, end_time: end }));

const resource = (over: Partial<ResourceSchedule> = {}): ResourceSchedule => ({
  id: 'ana',
  timezone: CDMX,
  rules: weekdays(),
  exceptions: [],
  busy: [],
  ...over,
});

// Monday 2026-10-05 in Mexico City.
const MON = { from: new Date('2026-10-05T06:00:00Z'), to: new Date('2026-10-06T06:00:00Z') };
const now = new Date('2026-10-01T00:00:00Z');
const iso = (slots: { starts_at: Date }[]) => slots.map((s) => s.starts_at.toISOString());

describe('time zones', () => {
  it('reads wall time in a zone', () => {
    expect(wallTime(new Date('2026-10-05T15:00:00Z'), CDMX)).toMatchObject({
      year: 2026,
      month: 10,
      day: 5,
      hour: 9,
      minute: 0,
    });
  });

  it('converts wall time to the instant', () => {
    expect(
      zonedTimeToInstant(
        { year: 2026, month: 10, day: 5, hour: 9, minute: 0 },
        CDMX,
      )?.toISOString(),
    ).toBe('2026-10-05T15:00:00.000Z');
  });

  it('returns null for times skipped by spring-forward', () => {
    expect(
      zonedTimeToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY),
    ).toBeNull();
  });

  it('resolves fall-back ambiguity to the first occurrence', () => {
    expect(
      zonedTimeToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY)?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });

  it('validates zone names', () => {
    expect(isTimeZone(CDMX)).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('computeSlots — weekly hours', () => {
  it('offers hourly slots inside opening hours, in the resource time zone', () => {
    const slots = computeSlots({ now, ...MON, service: service(), resources: [resource()] });
    expect(iso(slots)).toEqual(
      ['15:00', '16:00', '17:00', '18:00', '19:00'].map((h) => `2026-10-05T${h}:00.000Z`),
    );
    expect(slots[0]?.ends_at.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  });

  it('uses a custom interval', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service({ slot_interval_min: 30 }),
      resources: [resource()],
    });
    expect(slots).toHaveLength(9); // 09:00 … 13:00 every 30 min
  });

  it('never offers slots that end after closing', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service({ duration_min: 90, slot_interval_min: 30 }),
      resources: [resource()],
    });
    expect(iso(slots).at(-1)).toBe('2026-10-05T18:30:00.000Z'); // 12:30 + 90 min = 14:00
  });

  it('respects closed weekdays', () => {
    const sunday = { from: new Date('2026-10-04T06:00:00Z'), to: new Date('2026-10-05T06:00:00Z') };
    expect(computeSlots({ now, ...sunday, service: service(), resources: [resource()] })).toEqual(
      [],
    );
  });

  it('lets a rule use its own time zone', () => {
    const r = resource({
      timezone: 'UTC',
      rules: [{ weekday: 1, start_time: '09:00', end_time: '10:00', timezone: CDMX }],
    });
    expect(iso(computeSlots({ now, ...MON, service: service(), resources: [r] }))).toEqual([
      '2026-10-05T15:00:00.000Z',
    ]);
  });

  it('supports 24:00 as end of day', () => {
    const r = resource({ rules: [{ weekday: 1, start_time: '22:00', end_time: '24:00' }] });
    const slots = computeSlots({
      now,
      from: MON.from,
      to: new Date('2026-10-06T08:00:00Z'),
      service: service(),
      resources: [r],
    });
    expect(iso(slots)).toEqual(['2026-10-06T04:00:00.000Z', '2026-10-06T05:00:00.000Z']);
  });

  it('rejects invalid times with a hint', () => {
    try {
      computeSlots({
        now,
        ...MON,
        service: service(),
        resources: [resource({ rules: [{ weekday: 1, start_time: '9am', end_time: '14:00' }] })],
      });
      expect.unreachable();
    } catch (err) {
      expect(isSellbaseError(err) && err.hint).toContain('HH:MM');
    }
  });
});

describe('computeSlots — daylight saving (New York)', () => {
  const nyResource = (rules: ResourceSchedule['rules']) => resource({ timezone: NY, rules });

  it('skips the nonexistent hour on spring-forward day', () => {
    const day = { from: new Date('2026-03-08T05:00:00Z'), to: new Date('2026-03-09T04:00:00Z') };
    const slots = computeSlots({
      now: new Date('2026-03-01T00:00:00Z'),
      ...day,
      service: service({ duration_min: 30 }),
      resources: [nyResource([{ weekday: 0, start_time: '01:00', end_time: '04:00' }])],
    });
    // 01:00 EST = 06:00Z … 04:00 EDT = 08:00Z: only two real hours.
    expect(iso(slots)).toEqual(
      ['06:00', '06:30', '07:00', '07:30'].map((h) => `2026-03-08T${h}:00.000Z`),
    );
    expect(slots.every((s) => wallTime(s.starts_at, NY).hour !== 2)).toBe(true);
  });

  it('includes the repeated hour on fall-back day', () => {
    const day = { from: new Date('2026-11-01T04:00:00Z'), to: new Date('2026-11-02T05:00:00Z') };
    const slots = computeSlots({
      now: new Date('2026-10-25T00:00:00Z'),
      ...day,
      service: service(),
      resources: [nyResource([{ weekday: 0, start_time: '00:00', end_time: '03:00' }])],
    });
    // 00:00 EDT = 04:00Z … 03:00 EST = 08:00Z: four real hours.
    expect(slots).toHaveLength(4);
  });

  it('keeps local opening hours across the change', () => {
    const before = computeSlots({
      now: new Date('2026-10-20T00:00:00Z'),
      from: new Date('2026-10-30T04:00:00Z'),
      to: new Date('2026-10-31T04:00:00Z'),
      service: service(),
      resources: [nyResource([{ weekday: 5, start_time: '09:00', end_time: '10:00' }])],
    });
    const after = computeSlots({
      now: new Date('2026-10-20T00:00:00Z'),
      from: new Date('2026-11-06T05:00:00Z'),
      to: new Date('2026-11-07T05:00:00Z'),
      service: service(),
      resources: [nyResource([{ weekday: 5, start_time: '09:00', end_time: '10:00' }])],
    });
    expect(iso(before)).toEqual(['2026-10-30T13:00:00.000Z']); // EDT
    expect(iso(after)).toEqual(['2026-11-06T14:00:00.000Z']); // EST
  });
});

describe('computeSlots — bookings, buffers and capacity', () => {
  const booked = (start: string, end: string) => ({
    starts_at: new Date(start),
    ends_at: new Date(end),
  });

  it('removes slots that overlap existing bookings', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service(),
      resources: [resource({ busy: [booked('2026-10-05T16:00:00Z', '2026-10-05T17:00:00Z')] })],
    });
    expect(iso(slots)).not.toContain('2026-10-05T16:00:00.000Z');
    expect(slots).toHaveLength(4);
  });

  it('applies buffers around the new booking', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service({ buffer_after_min: 15 }),
      resources: [resource({ busy: [booked('2026-10-05T16:00:00Z', '2026-10-05T17:00:00Z')] })],
    });
    // 09:00 local ends 10:00 + 15 min buffer overlaps the 10:00 booking.
    expect(iso(slots)).not.toContain('2026-10-05T15:00:00.000Z');
  });

  it('computes the occupied range with both buffers', () => {
    const occ = occupiedRange(new Date('2026-10-05T15:00:00Z'), {
      duration_min: 60,
      buffer_before_min: 10,
      buffer_after_min: 15,
    });
    expect([occ.starts_at.toISOString(), occ.ends_at.toISOString()]).toEqual([
      '2026-10-05T14:50:00.000Z',
      '2026-10-05T16:15:00.000Z',
    ]);
  });

  it('allows overlaps up to the capacity', () => {
    const busy = [
      booked('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z'),
      booked('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z'),
    ];
    const two = computeSlots({
      now,
      ...MON,
      service: service({ capacity: 3 }),
      resources: [resource({ busy })],
    });
    expect(two[0]).toMatchObject({ remaining: 1 });
    const full = computeSlots({
      now,
      ...MON,
      service: service({ capacity: 2 }),
      resources: [resource({ busy })],
    });
    expect(iso(full)).not.toContain('2026-10-05T15:00:00.000Z');
  });

  it('merges resources and lists the least busy first', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service({ capacity: 2 }),
      resources: [
        resource({ id: 'ana', busy: [booked('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z')] }),
        resource({ id: 'luis' }),
      ],
    });
    expect(slots[0]).toMatchObject({ resource_ids: ['luis', 'ana'], remaining: 3 });
  });
});

describe('computeSlots — notice, window and exceptions', () => {
  it('enforces the minimum notice', () => {
    const at0930 = new Date('2026-10-05T15:30:00Z');
    const slots = computeSlots({
      now: at0930,
      ...MON,
      service: service({ min_notice_min: 60 }),
      resources: [resource()],
    });
    expect(iso(slots)[0]).toBe('2026-10-05T17:00:00.000Z'); // 10:30 is the minimum; next aligned slot is 11:00
  });

  it('enforces the booking window', () => {
    const slots = computeSlots({
      now: new Date('2026-10-05T06:00:00Z'),
      from: new Date('2026-10-05T06:00:00Z'),
      to: new Date('2026-10-31T06:00:00Z'),
      service: service({ booking_window_days: 7 }),
      resources: [resource()],
    });
    expect(slots.every((s) => s.starts_at < new Date('2026-10-12T06:00:00Z'))).toBe(true);
    expect(slots.length).toBe(25); // 5 weekdays × 5 slots
  });

  it('removes closed exceptions (holiday, lunch)', () => {
    const holiday = computeSlots({
      now,
      ...MON,
      service: service(),
      resources: [
        resource({ exceptions: [{ kind: 'closed', starts_at: MON.from, ends_at: MON.to }] }),
      ],
    });
    expect(holiday).toEqual([]);
    const lunch = computeSlots({
      now,
      ...MON,
      service: service(),
      resources: [
        resource({
          exceptions: [
            {
              kind: 'closed',
              starts_at: new Date('2026-10-05T19:00:00Z'),
              ends_at: new Date('2026-10-05T20:00:00Z'),
            },
          ],
        }),
      ],
    });
    expect(iso(lunch)).not.toContain('2026-10-05T19:00:00.000Z');
    expect(lunch).toHaveLength(4);
  });

  it('adds open exceptions (extra Saturday hours)', () => {
    const saturday = {
      from: new Date('2026-10-10T06:00:00Z'),
      to: new Date('2026-10-11T06:00:00Z'),
    };
    const slots = computeSlots({
      now,
      ...saturday,
      service: service(),
      resources: [
        resource({
          exceptions: [
            {
              kind: 'open',
              starts_at: new Date('2026-10-10T16:00:00Z'),
              ends_at: new Date('2026-10-10T18:00:00Z'),
            },
          ],
        }),
      ],
    });
    expect(iso(slots)).toEqual(['2026-10-10T16:00:00.000Z', '2026-10-10T17:00:00.000Z']);
  });

  it('keeps the slot grid when the range starts mid-window', () => {
    const slots = computeSlots({
      now,
      from: new Date('2026-10-05T16:23:00Z'),
      to: MON.to,
      service: service(),
      resources: [resource()],
    });
    expect(iso(slots)).toEqual(['17:00', '18:00', '19:00'].map((h) => `2026-10-05T${h}:00.000Z`));
  });

  it('confirms an exact start in a narrow range (checkout validation)', () => {
    const start = new Date('2026-10-05T17:00:00Z');
    const slots = computeSlots({
      now,
      from: new Date(start.getTime() - 1),
      to: new Date(start.getTime() + 1),
      service: service(),
      resources: [resource()],
    });
    expect(iso(slots)).toEqual(['2026-10-05T17:00:00.000Z']);
  });

  it('respects the requested range', () => {
    const slots = computeSlots({
      now,
      from: new Date('2026-10-05T17:00:00Z'),
      to: new Date('2026-10-05T18:30:00Z'),
      service: service(),
      resources: [resource()],
    });
    expect(iso(slots)).toEqual(['2026-10-05T17:00:00.000Z', '2026-10-05T18:00:00.000Z']);
  });
});

describe('isSlotAvailable', () => {
  it('checks start time and optional resource', () => {
    const slots = computeSlots({
      now,
      ...MON,
      service: service(),
      resources: [resource(), resource({ id: 'luis', rules: [] })],
    });
    expect(isSlotAvailable(slots, new Date('2026-10-05T15:00:00Z'))).toBe(true);
    expect(isSlotAvailable(slots, new Date('2026-10-05T15:00:00Z'), 'luis')).toBe(false);
    expect(isSlotAvailable(slots, new Date('2026-10-05T15:30:00Z'))).toBe(false);
  });
});
