import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components';
import { formatMoney } from '@sellbase/core';
import { messages, type Locale } from './i18n.js';

export interface EmailBrand {
  store_name: string;
  logo_url: string | null;
  /** Hex color for buttons and accents; defaults to near-black. */
  brand_color: string | null;
  contact_email: string | null;
}

export interface OrderConfirmationProps {
  brand: EmailBrand;
  locale: Locale;
  order: {
    number: number;
    currency: string;
    subtotal_amount: number;
    discount_amount: number;
    shipping_amount: number;
    tax_amount: number;
    tax_mode: 'inclusive' | 'exclusive';
    total_amount: number;
    items: {
      title: string;
      variant_title: string | null;
      quantity: number;
      total_amount: number;
    }[];
    requires_shipping: boolean;
  };
  downloads: { file_name: string; url: string; expires_at: string }[];
}

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function OrderConfirmation({ brand, locale, order, downloads }: OrderConfirmationProps) {
  const t = messages[locale];
  const accent = brand.brand_color ?? '#111111';
  const money = (amount: number) =>
    formatMoney(amount, order.currency, locale === 'es' ? 'es-MX' : 'en-US');
  const localeTag = locale === 'es' ? 'es-MX' : 'en-US';

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{t.preview(brand.store_name, order.number)}</Preview>
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
            {t.thanks}
          </Heading>
          <Text style={{ color: '#555555', margin: '0 0 24px' }}>
            {t.orderNumber(order.number)} {order.requires_shipping ? t.willShip : ''}
          </Text>

          {downloads.length > 0 && (
            <Section
              style={{
                backgroundColor: '#f3f4f6',
                borderRadius: 8,
                padding: '16px 20px',
                marginBottom: 24,
              }}
            >
              <Text style={{ fontWeight: 600, margin: '0 0 12px' }}>{t.downloadsTitle}</Text>
              {downloads.map((d) => (
                <Row key={d.url} style={{ marginBottom: 12 }}>
                  <Column>
                    <Text style={{ margin: 0 }}>{d.file_name}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12, margin: 0 }}>
                      {t.expires(
                        new Date(d.expires_at).toLocaleDateString(localeTag, {
                          dateStyle: 'medium',
                        }),
                      )}
                    </Text>
                  </Column>
                  <Column align="right">
                    <Button
                      href={d.url}
                      style={{
                        backgroundColor: accent,
                        borderRadius: 6,
                        color: '#ffffff',
                        fontSize: 14,
                        padding: '8px 14px',
                      }}
                    >
                      {t.download}
                    </Button>
                  </Column>
                </Row>
              ))}
            </Section>
          )}

          <Section>
            {order.items.map((item, i) => (
              <Row key={i} style={{ marginBottom: 8 }}>
                <Column>
                  <Text style={{ margin: 0 }}>
                    {item.title}
                    {item.variant_title ? ` — ${item.variant_title}` : ''} × {item.quantity}
                  </Text>
                </Column>
                <Column align="right">
                  <Text style={{ margin: 0 }}>{money(item.total_amount)}</Text>
                </Column>
              </Row>
            ))}
          </Section>

          <Hr style={{ borderColor: '#e5e7eb', margin: '16px 0' }} />

          <Section>
            <TotalRow label={t.subtotal} value={money(order.subtotal_amount)} />
            {order.discount_amount > 0 && (
              <TotalRow label={t.discount} value={`−${money(order.discount_amount)}`} />
            )}
            {order.requires_shipping && (
              <TotalRow
                label={t.shipping}
                value={order.shipping_amount ? money(order.shipping_amount) : t.free}
              />
            )}
            {order.tax_amount > 0 && order.tax_mode === 'exclusive' && (
              <TotalRow label={t.tax} value={money(order.tax_amount)} />
            )}
            <TotalRow label={t.total} value={money(order.total_amount)} strong />
            {order.tax_amount > 0 && order.tax_mode === 'inclusive' && (
              <Text
                style={{ color: '#6b7280', fontSize: 12, margin: '4px 0 0', textAlign: 'right' }}
              >
                {t.taxIncluded(money(order.tax_amount))}
              </Text>
            )}
          </Section>

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

function TotalRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const style = { margin: '2px 0', fontWeight: strong ? 700 : 400, fontSize: strong ? 16 : 14 };
  return (
    <Row>
      <Column>
        <Text style={style}>{label}</Text>
      </Column>
      <Column align="right">
        <Text style={style}>{value}</Text>
      </Column>
    </Row>
  );
}
