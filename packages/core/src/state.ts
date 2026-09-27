import { sellbaseError } from './errors.js';
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from './schemas/commerce.js';

/**
 * State machines (SPEC §5.6). The same transition tables are mirrored in SQL with
 * check constraints / triggers; keep both in sync.
 */

export interface StateMachine<S extends string> {
  name: string;
  transitions: Readonly<Record<S, readonly S[]>>;
  canTransition(from: S, to: S): boolean;
  assertTransition(from: S, to: S): void;
}

export function defineMachine<S extends string>(
  name: string,
  transitions: Readonly<Record<S, readonly S[]>>,
): StateMachine<S> {
  const canTransition = (from: S, to: S) => transitions[from].includes(to);
  return {
    name,
    transitions,
    canTransition,
    assertTransition(from, to) {
      if (canTransition(from, to)) return;
      const allowed = transitions[from];
      throw sellbaseError(
        'INVALID_TRANSITION',
        `${name} cannot go from "${from}" to "${to}".`,
        allowed.length
          ? `From "${from}" the allowed next states are: ${allowed.join(', ')}.`
          : `"${from}" is final; no further changes are allowed.`,
        { machine: name, from, to, allowed },
      );
    },
  };
}

export const orderStatusMachine = defineMachine<OrderStatus>('order.status', {
  pending_payment: ['open', 'cancelled'],
  open: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

export const fulfillmentStatusMachine = defineMachine<FulfillmentStatus>(
  'order.fulfillment_status',
  {
    unfulfilled: ['partially_fulfilled', 'fulfilled'],
    partially_fulfilled: ['fulfilled'],
    fulfilled: [],
  },
);

export type BookingStatus = 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';

/** `rescheduled` closes the original booking; the new slot is a new linked booking. */
export const bookingStatusMachine = defineMachine<BookingStatus>('booking.status', {
  confirmed: ['completed', 'no_show', 'cancelled', 'rescheduled'],
  completed: [],
  no_show: [],
  cancelled: [],
  rescheduled: [],
});

/** Payment status is derived from amounts, never set by hand. */
export function derivePaymentStatus(input: {
  total_amount: number;
  amount_paid: number;
  amount_refunded: number;
}): PaymentStatus {
  const { total_amount, amount_paid, amount_refunded } = input;
  if (amount_refunded > 0)
    return amount_refunded >= amount_paid ? 'refunded' : 'partially_refunded';
  if (amount_paid <= 0) return total_amount === 0 ? 'paid' : 'unpaid';
  return amount_paid >= total_amount ? 'paid' : 'partially_paid';
}

/** Fulfillment status from per-line quantities. Lines that need no fulfillment are skipped. */
export function deriveFulfillmentStatus(
  lines: readonly { quantity: number; fulfilled_quantity: number }[],
): FulfillmentStatus {
  const relevant = lines.filter((l) => l.quantity > 0);
  if (relevant.length === 0) return 'fulfilled';
  const done = relevant.filter((l) => l.fulfilled_quantity >= l.quantity).length;
  if (done === relevant.length) return 'fulfilled';
  const started = relevant.some((l) => l.fulfilled_quantity > 0);
  return started ? 'partially_fulfilled' : 'unfulfilled';
}

/**
 * An open order completes when it is paid and fulfilled. Bookings count as fulfilled
 * only once every booking is `completed` (or closed as no-show/rescheduled).
 */
export function shouldCompleteOrder(input: {
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  booking_statuses?: readonly BookingStatus[];
}): boolean {
  if (input.status !== 'open') return false;
  if (input.payment_status !== 'paid') return false;
  if (input.fulfillment_status !== 'fulfilled') return false;
  const bookings = input.booking_statuses ?? [];
  return bookings.every((s) => s === 'completed' || s === 'no_show' || s === 'rescheduled');
}
