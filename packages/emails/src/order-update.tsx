import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from '@react-email/components';
import { formatMoney } from '@sellbase/core';
import { messages, type Locale } from './i18n.js';
import type { EmailBrand } from './order-confirmation.js';

export type OrderUpdateProps = {
  brand: EmailBrand;
  locale: Locale;
  order: { number: number; currency: string };
} & (
  | {
      kind: 'shipped';
      carrier: string | null;
      tracking_number: string | null;
      tracking_url: string | null;
    }
  | { kind: 'refunded'; amount: number }
  | { kind: 'cancelled'; refunded_amount: number }
);

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function OrderUpdate(props: OrderUpdateProps) {
  const { brand, locale, order } = props;
  const t = messages[locale];
  const money = (n: number) => formatMoney(n, order.currency, locale === 'es' ? 'es-MX' : 'en-US');
  const accent = brand.brand_color ?? '#111111';
  const copy = t[props.kind];

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.title}</Preview>
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
          <Text style={{ color: '#555555' }}>{t.orderNumber(order.number)}</Text>

          {props.kind === 'shipped' && (
            <>
              <Text>{t.shipped.body}</Text>
              {props.carrier && props.tracking_number && (
                <Text>{t.shipped.carrier(props.carrier, props.tracking_number)}</Text>
              )}
              {props.tracking_url && (
                <Button
                  href={props.tracking_url}
                  style={{
                    backgroundColor: accent,
                    borderRadius: 6,
                    color: '#ffffff',
                    padding: '10px 16px',
                  }}
                >
                  {t.shipped.track}
                </Button>
              )}
            </>
          )}
          {props.kind === 'refunded' && <Text>{t.refunded.body(money(props.amount))}</Text>}
          {props.kind === 'cancelled' && (
            <>
              <Text>{t.cancelled.body}</Text>
              {props.refunded_amount > 0 && (
                <Text>{t.cancelled.refundNote(money(props.refunded_amount))}</Text>
              )}
            </>
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
