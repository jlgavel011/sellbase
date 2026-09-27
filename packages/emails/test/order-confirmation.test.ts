import { describe, expect, it } from 'vitest';
import { renderOrderConfirmation, type OrderConfirmationProps } from '../src/index.js';

const props: OrderConfirmationProps = {
  brand: {
    store_name: 'Tienda Luna',
    logo_url: null,
    brand_color: '#7c3aed',
    contact_email: 'hola@luna.mx',
  },
  locale: 'es',
  order: {
    number: 1001,
    currency: 'MXN',
    subtotal_amount: 89700,
    discount_amount: 8970,
    shipping_amount: 9900,
    tax_amount: 12500,
    tax_mode: 'inclusive',
    total_amount: 90630,
    items: [
      { title: 'Playera <Negra>', variant_title: 'M', quantity: 2, total_amount: 62820 },
      { title: 'Guía PDF', variant_title: null, quantity: 1, total_amount: 17910 },
    ],
    requires_shipping: true,
  },
  downloads: [
    { file_name: 'guia.pdf', url: 'https://x.test/d/abc', expires_at: '2026-10-01T00:00:00Z' },
  ],
};

describe('order confirmation email', () => {
  it('renders Spanish HTML and text with totals and download links', async () => {
    const email = await renderOrderConfirmation(props);
    expect(email.subject).toBe('Pedido #1001 confirmado');
    expect(email.html).toContain('$906.30');
    expect(email.html).toContain('https://x.test/d/abc');
    expect(email.html).toContain('#7c3aed');
    expect(email.html).toContain('Incluye $125.00 de impuestos');
    expect(email.text).toContain('Pedido #1001');
    expect(email.text).toContain('https://x.test/d/abc');
  });

  it('escapes product titles', async () => {
    const email = await renderOrderConfirmation(props);
    expect(email.html).not.toContain('<Negra>');
    expect(email.html).toContain('&lt;Negra&gt;');
  });

  it('renders English', async () => {
    const email = await renderOrderConfirmation({ ...props, locale: 'en' });
    expect(email.subject).toBe('Order #1001 confirmed');
    expect(email.html).toContain('Your downloads');
  });

  it('omits downloads and shipping when not applicable', async () => {
    const email = await renderOrderConfirmation({
      ...props,
      downloads: [],
      order: { ...props.order, requires_shipping: false },
    });
    expect(email.html).not.toContain('Tus descargas');
    expect(email.html).not.toContain('Envío');
  });
});
