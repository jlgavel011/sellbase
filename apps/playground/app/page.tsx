import { calculateTotals, formatMoney } from '@sellbase/core';

// Phase 0: proves @sellbase/core is consumable from a real app. The storefront
// components replace this page in Phase 1.
const sample = calculateTotals({
  currency: 'MXN',
  lines: [
    { id: 'tee', unit_price_amount: 34900, quantity: 2 },
    { id: 'mug', unit_price_amount: 19900, quantity: 1 },
  ],
  discounts: [{ id: 'welcome', code: 'BIENVENIDA', kind: 'percent', value: 1000 }],
  shipping_amount: 9900,
  tax: { mode: 'inclusive', rate_bps: 1600 },
});

const rows: [string, number][] = [
  ['Subtotal', sample.subtotal_amount],
  ['Descuento', -sample.discount_amount],
  ['Envío', sample.shipping_amount],
  ['IVA incluido', sample.tax_amount],
  ['Total', sample.total_amount],
];

export default function Home() {
  return (
    <main>
      <h1>Sellbase Playground</h1>
      <table>
        <tbody>
          {rows.map(([label, amount]) => (
            <tr key={label}>
              <th style={{ textAlign: 'left', paddingRight: '2rem' }}>{label}</th>
              <td data-testid={`total-${label}`}>{formatMoney(amount, sample.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
