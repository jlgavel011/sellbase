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

describe('order update emails', () => {
  const base = {
    brand: props.brand,
    locale: 'es' as const,
    order: { number: 1001, currency: 'MXN' },
  };

  it('renders shipped with tracking', async () => {
    const { renderOrderUpdate } = await import('../src/index.js');
    const email = await renderOrderUpdate({
      ...base,
      kind: 'shipped',
      carrier: 'Estafeta',
      tracking_number: 'EST123',
      tracking_url: 'https://track.test/EST123',
    });
    expect(email.subject).toBe('Tu pedido #1001 va en camino');
    expect(email.html).toContain('https://track.test/EST123');
    expect(email.text).toContain('Estafeta · guía EST123');
  });

  it('renders refunds and cancellations with amounts', async () => {
    const { renderOrderUpdate } = await import('../src/index.js');
    expect((await renderOrderUpdate({ ...base, kind: 'refunded', amount: 34900 })).text).toContain(
      '$349.00',
    );
    const cancelled = await renderOrderUpdate({ ...base, kind: 'cancelled', refunded_amount: 0 });
    expect(cancelled.subject).toBe('Pedido #1001 cancelado');
    expect(cancelled.text).not.toContain('reembolsamos');
  });
});

describe('booking emails', () => {
  const booking = {
    title: 'Masaje relajante',
    when: 'lunes, 5 de octubre de 2026, 9:00',
    resource_name: 'Ana',
    meeting_url: 'https://meet.test/abc',
    calendar_url: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
  };

  it('shows the appointment in the order confirmation', async () => {
    const { renderOrderConfirmation } = await import('../src/index.js');
    const email = await renderOrderConfirmation({ ...props, bookings: [booking] });
    expect(email.html).toContain('Tu cita');
    expect(email.html).toContain('con Ana');
    expect(email.html).toContain('https://meet.test/abc');
  });

  it('renders reminders, reschedules and cancellations', async () => {
    const { renderBookingNotice } = await import('../src/index.js');
    const base = { brand: props.brand, locale: 'es' as const, booking };
    expect((await renderBookingNotice({ ...base, kind: 'reminder' })).subject).toBe(
      'Recordatorio: Masaje relajante, lunes, 5 de octubre de 2026, 9:00',
    );
    expect((await renderBookingNotice({ ...base, kind: 'rescheduled' })).text).toContain(
      'nuevo horario',
    );
    const cancelled = await renderBookingNotice({
      ...base,
      kind: 'cancelled',
      refunded_amount: 80000,
      currency: 'MXN',
    });
    expect(cancelled.text).toContain('$800.00');
    expect(cancelled.html).not.toContain('meet.test');
  });

  it('formats times in the store time zone', async () => {
    const { formatWhen } = await import('../src/index.js');
    expect(formatWhen(new Date('2026-10-05T15:00:00Z'), 'America/Mexico_City', 'es')).toContain(
      '9:00',
    );
  });
});
