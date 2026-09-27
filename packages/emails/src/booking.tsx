import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { formatMoney } from '@sellbase/core';
import { messages, type Locale } from './i18n.js';
import type { EmailBrand } from './order-confirmation.js';

/** One appointment as shown in emails. `when` is already formatted in the store time zone. */
export interface EmailBooking {
  title: string;
  when: string;
  resource_name: string | null;
  meeting_url: string | null;
  calendar_url: string;
}

export function BookingBlock({
  booking,
  locale,
  accent,
}: {
  booking: EmailBooking;
  locale: Locale;
  accent: string;
}) {
  const t = messages[locale];
  return (
    <Section
      style={{
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        padding: '16px 20px',
        marginBottom: 16,
      }}
    >
      <Text style={{ fontWeight: 600, margin: '0 0 4px' }}>{booking.title}</Text>
      <Text style={{ margin: '0 0 4px' }}>{booking.when}</Text>
      {booking.resource_name && (
        <Text style={{ color: '#6b7280', margin: '0 0 12px' }}>
          {t.withResource(booking.resource_name)}
        </Text>
      )}
      {booking.meeting_url && (
        <Button
          href={booking.meeting_url}
          style={{
            backgroundColor: accent,
            borderRadius: 6,
            color: '#ffffff',
            fontSize: 14,
            padding: '8px 14px',
            marginRight: 12,
          }}
        >
          {t.joinOnline}
        </Button>
      )}
      <Link href={booking.calendar_url} style={{ color: accent, fontSize: 14 }}>
        {t.addToCalendar}
      </Link>
    </Section>
  );
}

export type BookingNoticeProps = {
  brand: EmailBrand;
  locale: Locale;
  booking: EmailBooking;
} & (
  | { kind: 'reminder' }
  | { kind: 'rescheduled' }
  | { kind: 'cancelled'; refunded_amount: number; currency: string }
);

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function BookingNotice(props: BookingNoticeProps) {
  const { brand, locale, booking } = props;
  const t = messages[locale];
  const copy = props.kind === 'cancelled' ? t.bookingCancelled : t[props.kind];
  const accent = brand.brand_color ?? '#111111';
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{`${copy.title}: ${booking.title}, ${booking.when}`}</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: font, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 8,
            maxWidth: 560,
            padding: '32px 28px',
          }}
        >
          {brand.logo_url ? (
            <Img
              src={brand.logo_url}
              alt={brand.store_name}
              height={40}
              style={{ marginBottom: 24 }}
            />
          ) : (
            <Text style={{ fontSize: 18, fontWeight: 700, margin: '0 0 24px' }}>
              {brand.store_name}
            </Text>
          )}
          <Heading as="h1" style={{ fontSize: 22, margin: '0 0 8px' }}>
            {copy.title}
          </Heading>
          <Text>{copy.body}</Text>
          <BookingBlock
            booking={props.kind === 'cancelled' ? { ...booking, meeting_url: null } : booking}
            locale={locale}
            accent={accent}
          />
          {props.kind === 'cancelled' && props.refunded_amount > 0 && (
            <Text>
              {t.bookingCancelled.refundNote(
                formatMoney(
                  props.refunded_amount,
                  props.currency,
                  locale === 'es' ? 'es-MX' : 'en-US',
                ),
              )}
            </Text>
          )}
          {brand.contact_email && (
            <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 32 }}>
              {t.questions(brand.contact_email)}
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

/** "lunes, 5 de octubre de 2026, 9:00 (hora de Ciudad de México)" */
export function formatWhen(start: Date, timezone: string, locale: Locale): string {
  const tag = locale === 'es' ? 'es-MX' : 'en-US';
  const date = new Intl.DateTimeFormat(tag, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(start);
  const zone = new Intl.DateTimeFormat(tag, { timeZone: timezone, timeZoneName: 'long' })
    .formatToParts(start)
    .find((p) => p.type === 'timeZoneName')?.value;
  return zone ? `${date} (${zone})` : date;
}
