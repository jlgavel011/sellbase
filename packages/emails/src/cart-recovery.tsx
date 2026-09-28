import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import { formatMoney } from '@sellbase/core';
import { messages, type Locale } from './i18n.js';
import type { EmailBrand } from './order-confirmation.js';

export interface CartRecoveryProps {
  brand: EmailBrand;
  locale: Locale;
  currency: string;
  total_amount: number;
  items: {
    title: string;
    variant_title: string | null;
    quantity: number;
    image_url: string | null;
  }[];
  /** Storefront URL that restores the cart (?sellbase_cart=…). */
  url: string;
}

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MAX_ITEMS = 4;

/** "You left something in your cart": sent once per abandoned checkout. */
export function CartRecovery({
  brand,
  locale,
  currency,
  total_amount,
  items,
  url,
}: CartRecoveryProps) {
  const t = messages[locale];
  const accent = brand.brand_color ?? '#111111';
  const money = (n: number) => formatMoney(n, currency, locale === 'es' ? 'es-MX' : 'en-US');
  const shown = items.slice(0, MAX_ITEMS);

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.cartRecovery.title}</Preview>
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
            {t.cartRecovery.title}
          </Heading>
          <Text style={{ color: '#555555' }}>{t.cartRecovery.body}</Text>
          <Section style={{ margin: '16px 0' }}>
            {shown.map((item, i) => (
              <Row key={i} style={{ marginBottom: 12 }}>
                <Column style={{ width: 64, verticalAlign: 'middle' }}>
                  {item.image_url ? (
                    <Img
                      src={item.image_url}
                      alt=""
                      width={56}
                      height={56}
                      style={{ borderRadius: 6, objectFit: 'cover' }}
                    />
                  ) : null}
                </Column>
                <Column style={{ verticalAlign: 'middle' }}>
                  <Text style={{ margin: 0, fontWeight: 600 }}>
                    {item.title}
                    {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                  </Text>
                  {item.variant_title && item.variant_title !== 'Default' && (
                    <Text style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
                      {item.variant_title}
                    </Text>
                  )}
                </Column>
              </Row>
            ))}
            {items.length > MAX_ITEMS && (
              <Text style={{ color: '#6b7280', fontSize: 13 }}>
                {t.cartRecovery.more(items.length - MAX_ITEMS)}
              </Text>
            )}
          </Section>
          <Text style={{ fontWeight: 600 }}>
            {t.cartRecovery.total}: {money(total_amount)}
          </Text>
          <Button
            href={url}
            style={{
              backgroundColor: accent,
              borderRadius: 6,
              color: '#ffffff',
              padding: '12px 20px',
              fontWeight: 600,
            }}
          >
            {t.cartRecovery.cta}
          </Button>
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
