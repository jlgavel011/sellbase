import { describe, expect, it } from 'vitest';
import { googleCalendarUrl, toIcs } from '../src/index.js';

const event = {
  uid: 'b1@sellbase',
  starts_at: new Date('2026-10-05T15:00:00Z'),
  ends_at: new Date('2026-10-05T16:00:00Z'),
  summary: 'Masaje; 60 min, con Ana',
  description: 'Línea 1\nLínea 2',
  location: 'Av. Reforma 222, CDMX',
};

describe('ics', () => {
  it('builds a valid VEVENT with escaped text and UTC times', () => {
    const ics = toIcs(event, new Date('2026-10-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20261005T150000Z');
    expect(ics).toContain('DTEND:20261005T160000Z');
    expect(ics).toContain('SUMMARY:Masaje\\; 60 min\\, con Ana');
    expect(ics).toContain('DESCRIPTION:Línea 1\\nLínea 2');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('links to Google Calendar', () => {
    const url = new URL(googleCalendarUrl(event));
    expect(url.searchParams.get('dates')).toBe('20261005T150000Z/20261005T160000Z');
    expect(url.searchParams.get('text')).toBe(event.summary);
  });
});
