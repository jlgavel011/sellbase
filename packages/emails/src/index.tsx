import { render } from '@react-email/render';
import { messages } from './i18n.js';
import { OrderConfirmation, type OrderConfirmationProps } from './order-confirmation.js';
import { OrderUpdate, type OrderUpdateProps } from './order-update.js';
import { BookingNotice, type BookingNoticeProps } from './booking.js';

export {
  OrderConfirmation,
  type OrderConfirmationProps,
  type EmailBrand,
} from './order-confirmation.js';
export { messages, toLocale, type Locale } from './i18n.js';
export { OrderUpdate, type OrderUpdateProps } from './order-update.js';
export {
  BookingNotice,
  formatWhen,
  type BookingNoticeProps,
  type EmailBooking,
} from './booking.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderOrderConfirmation(
  props: OrderConfirmationProps,
): Promise<RenderedEmail> {
  const element = <OrderConfirmation {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: messages[props.locale].subject(props.order.number), html, text };
}

export async function renderOrderUpdate(props: OrderUpdateProps): Promise<RenderedEmail> {
  const element = <OrderUpdate {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: messages[props.locale][props.kind].subject(props.order.number), html, text };
}

export async function renderBookingNotice(props: BookingNoticeProps): Promise<RenderedEmail> {
  const element = <BookingNotice {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const t = messages[props.locale];
  const subject =
    props.kind === 'reminder'
      ? t.reminder.subject(props.booking.title, props.booking.when)
      : props.kind === 'rescheduled'
        ? t.rescheduled.subject(props.booking.title)
        : t.bookingCancelled.subject(props.booking.title);
  return { subject, html, text };
}
