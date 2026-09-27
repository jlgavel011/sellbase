import { describe, expect, it } from 'vitest';
import {
  bookingStatusMachine,
  derivePaymentStatus,
  deriveFulfillmentStatus,
  fulfillmentStatusMachine,
  isSellbaseError,
  orderStatusMachine,
  shouldCompleteOrder,
} from '../src/index.js';

describe('order status machine', () => {
  it('allows the documented transitions', () => {
    expect(orderStatusMachine.canTransition('pending_payment', 'open')).toBe(true);
    expect(orderStatusMachine.canTransition('pending_payment', 'cancelled')).toBe(true);
    expect(orderStatusMachine.canTransition('open', 'completed')).toBe(true);
    expect(orderStatusMachine.canTransition('open', 'cancelled')).toBe(true);
  });

  it('rejects everything else with INVALID_TRANSITION and a hint', () => {
    expect(orderStatusMachine.canTransition('completed', 'cancelled')).toBe(false);
    expect(orderStatusMachine.canTransition('pending_payment', 'completed')).toBe(false);
    try {
      orderStatusMachine.assertTransition('open', 'pending_payment');
      expect.unreachable();
    } catch (err) {
      expect(isSellbaseError(err) && err.code).toBe('INVALID_TRANSITION');
      expect(isSellbaseError(err) && err.hint).toContain('completed, cancelled');
    }
  });

  it('explains final states', () => {
    expect(() => orderStatusMachine.assertTransition('cancelled', 'open')).toThrow(/cannot go/);
    try {
      orderStatusMachine.assertTransition('cancelled', 'open');
    } catch (err) {
      expect(isSellbaseError(err) && err.hint).toContain('final');
    }
  });
});

describe('fulfillment and booking machines', () => {
  it('fulfillment only moves forward', () => {
    expect(fulfillmentStatusMachine.canTransition('unfulfilled', 'fulfilled')).toBe(true);
    expect(fulfillmentStatusMachine.canTransition('fulfilled', 'unfulfilled')).toBe(false);
  });

  it('bookings close from confirmed only', () => {
    expect(bookingStatusMachine.canTransition('confirmed', 'rescheduled')).toBe(true);
    expect(bookingStatusMachine.canTransition('completed', 'cancelled')).toBe(false);
  });
});

describe('derivePaymentStatus', () => {
  it.each([
    [{ total_amount: 1000, amount_paid: 0, amount_refunded: 0 }, 'unpaid'],
    [{ total_amount: 1000, amount_paid: 300, amount_refunded: 0 }, 'partially_paid'],
    [{ total_amount: 1000, amount_paid: 1000, amount_refunded: 0 }, 'paid'],
    [{ total_amount: 1000, amount_paid: 1000, amount_refunded: 200 }, 'partially_refunded'],
    [{ total_amount: 1000, amount_paid: 1000, amount_refunded: 1000 }, 'refunded'],
    [{ total_amount: 0, amount_paid: 0, amount_refunded: 0 }, 'paid'],
  ] as const)('%o → %s', (input, expected) => {
    expect(derivePaymentStatus(input)).toBe(expected);
  });
});

describe('deriveFulfillmentStatus', () => {
  it('reflects line progress', () => {
    expect(deriveFulfillmentStatus([{ quantity: 2, fulfilled_quantity: 0 }])).toBe('unfulfilled');
    expect(deriveFulfillmentStatus([{ quantity: 2, fulfilled_quantity: 1 }])).toBe(
      'partially_fulfilled',
    );
    expect(
      deriveFulfillmentStatus([
        { quantity: 2, fulfilled_quantity: 2 },
        { quantity: 1, fulfilled_quantity: 1 },
      ]),
    ).toBe('fulfilled');
  });
});

describe('shouldCompleteOrder', () => {
  const ready = {
    status: 'open',
    payment_status: 'paid',
    fulfillment_status: 'fulfilled',
  } as const;

  it('completes paid and fulfilled open orders', () => {
    expect(shouldCompleteOrder(ready)).toBe(true);
  });

  it('waits for payment, fulfillment and bookings', () => {
    expect(shouldCompleteOrder({ ...ready, payment_status: 'partially_paid' })).toBe(false);
    expect(shouldCompleteOrder({ ...ready, fulfillment_status: 'partially_fulfilled' })).toBe(
      false,
    );
    expect(shouldCompleteOrder({ ...ready, booking_statuses: ['completed', 'confirmed'] })).toBe(
      false,
    );
    expect(shouldCompleteOrder({ ...ready, booking_statuses: ['completed', 'no_show'] })).toBe(
      true,
    );
  });

  it('never completes non-open orders', () => {
    expect(shouldCompleteOrder({ ...ready, status: 'pending_payment' })).toBe(false);
  });
});
