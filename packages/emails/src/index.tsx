import { render } from '@react-email/render';
import { messages } from './i18n.js';
import { OrderConfirmation, type OrderConfirmationProps } from './order-confirmation.js';

export {
  OrderConfirmation,
  type OrderConfirmationProps,
  type EmailBrand,
} from './order-confirmation.js';
export { messages, toLocale, type Locale } from './i18n.js';

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
