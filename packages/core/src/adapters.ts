import type { Address, PaymentMethod } from './schemas/index.js';

/**
 * Provider adapter contracts (SPEC §8, §9, §10). Implementations live in
 * packages/adapters; the API only talks to these interfaces. Adapters are the one
 * place where classes are allowed, but plain objects work too.
 */

// ── Payments ─────────────────────────────────────────────────────────────────

export interface CheckoutLineForProvider {
  title: string;
  quantity: number;
  /** Final per-line total after discounts, in minor units. */
  total_amount: number;
  image_url?: string;
}

export interface CreateCheckoutInput {
  /** Sellbase checkout session, or null for a balance payment on an existing order. */
  checkout_session_id: string | null;
  /** Balance payments: the order being paid. */
  order_id?: string;
  /** Live verification charge (no order): refunded as soon as it is paid. */
  live_check_id?: string;
  store_id: string;
  currency: string;
  amount_total: number;
  email: string;
  lines: CheckoutLineForProvider[];
  shipping_amount: number;
  success_url: string;
  cancel_url: string;
  /** Session expiry; providers should not accept payment after it. */
  expires_at: Date;
  locale?: string;
  /** Idempotency key forwarded to the provider. */
  idempotency_key: string;
}

/**
 * Phase 1 uses `redirect` (Stripe Checkout). Phase 2 adds `embedded` (Elements / Bricks)
 * without changing callers (SPEC §19.4).
 */
export type CreateCheckoutResult =
  | { mode: 'redirect'; provider_session_id: string; url: string }
  | { mode: 'embedded'; provider_session_id: string; client_secret: string };

export interface ProviderEvent {
  id: string;
  type: string;
  data: unknown;
  /** True for real-money events, false for test mode. */
  livemode?: boolean;
}

export type NormalizedPaymentEvent =
  | {
      type: 'checkout.paid';
      provider_event_id: string;
      checkout_session_id: string;
      provider_payment_id: string;
      method: PaymentMethod;
      amount: number;
      currency: string;
      raw: unknown;
    }
  | { type: 'checkout.expired'; provider_event_id: string; checkout_session_id: string }
  | {
      type: 'order.balance_paid';
      provider_event_id: string;
      order_id: string;
      provider_payment_id: string;
      method: PaymentMethod;
      amount: number;
      currency: string;
      raw: unknown;
    }
  | {
      type: 'checkout.pending';
      provider_event_id: string;
      checkout_session_id: string;
      method: PaymentMethod;
    }
  | {
      type: 'payment.failed';
      provider_event_id: string;
      checkout_session_id: string;
      reason: string;
    }
  | {
      type: 'live_check.paid';
      provider_event_id: string;
      live_check_id: string;
      provider_payment_id: string;
      amount: number;
      currency: string;
    };

/** Provider account as the owner sees it in the provider dashboard. */
export interface PaymentAccount {
  id: string;
  name: string | null;
  country: string;
  default_currency: string;
  mode: 'test' | 'live';
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
}

/** Smallest charge the provider accepts, in minor units (Stripe's documented minimums). */
export const MIN_CHARGE: Record<string, number> = {
  MXN: 1000,
  USD: 50,
  EUR: 50,
  GBP: 30,
  CAD: 50,
  BRL: 50,
  COP: 200000,
  CLP: 50000,
};

export interface RefundRequest {
  provider_payment_id: string;
  amount: number;
  reason: string;
  idempotency_key: string;
}

export interface SandboxChargeInput {
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  idempotency_key: string;
}

export interface SandboxChargeResult {
  provider_payment_id: string;
  method: PaymentMethod;
  amount: number;
  currency: string;
}

export interface RefundResult {
  provider_refund_id: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentsAdapter {
  id: string;
  supportedMethods(country: string, currency: string): PaymentMethod[];
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  /** Throws if the signature is invalid. */
  verifyWebhook(req: Request, secret: string): Promise<ProviderEvent>;
  mapEvent(evt: ProviderEvent): NormalizedPaymentEvent | null;
  refund(input: RefundRequest): Promise<RefundResult>;
  /**
   * Test mode only: charges a provider test card server-side so `test_purchase` can run a
   * real payment without a browser. Must refuse with live credentials.
   */
  sandboxCharge?(input: SandboxChargeInput): Promise<SandboxChargeResult>;
  /** Checks credentials; the message explains what to fix. */
  test(): Promise<{ ok: boolean; message: string }>;
  /** Test or live credentials. */
  mode?(): 'test' | 'live';
  /** Account details for the doctor and the admin. */
  account?(): Promise<PaymentAccount>;
  /**
   * Makes sure the provider sends the events Sellbase needs to `url`. Returns the signing
   * secret when it created the endpoint (the provider only reveals it once). Without a
   * stored secret an existing endpoint for the same URL is replaced.
   */
  ensureWebhook?(
    url: string,
    options: { haveSecret: boolean },
  ): Promise<{ endpoint_id: string; secret: string | null; created: boolean }>;
}

// ── Shipping ─────────────────────────────────────────────────────────────────

export interface Parcel {
  weight_g: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
}

export interface ShippingRate {
  id: string;
  carrier: string;
  service: string;
  amount: number;
  currency: string;
  estimated_days?: { min: number; max: number };
  /** e.g. pickup in store: no shipping address required. */
  requires_address: boolean;
}

export interface ShippingQuoteInput {
  from: Address | null;
  to: Address | null;
  parcels: Parcel[];
  currency: string;
  /** Merchandise subtotal after discounts, for "free over X" rules. */
  subtotal_amount: number;
}

export interface Label {
  carrier: string;
  service: string;
  tracking_number: string;
  tracking_url: string | null;
  label_url: string | null;
  rate_amount: number;
}

export type TrackingStatus =
  'label_created' | 'in_transit' | 'delivered' | 'exception' | 'returned';

export interface ShippingAdapter {
  id: string;
  quote(input: ShippingQuoteInput): Promise<ShippingRate[]>;
  createLabel?(input: { rateId: string; orderId: string }): Promise<Label>;
  track?(trackingNumber: string, carrier: string): Promise<{ status: TrackingStatus }>;
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface NotifyMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  reply_to?: string;
  /** Provider-level idempotency so retries never double send. */
  idempotency_key: string;
  attachments?: { filename: string; content_base64: string; content_type: string }[];
}

export interface NotifyAdapter {
  id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  send(message: NotifyMessage): Promise<{ provider_message_id: string }>;
  test(): Promise<{ ok: boolean; message: string }>;
}
