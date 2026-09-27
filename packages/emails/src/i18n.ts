export type Locale = 'es' | 'en';

export const toLocale = (value: string | null | undefined): Locale =>
  value?.startsWith('en') ? 'en' : 'es';

export const messages = {
  es: {
    subject: (n: number) => `Pedido #${n} confirmado`,
    preview: (store: string, n: number) => `Gracias por tu compra en ${store}. Pedido #${n}.`,
    thanks: '¡Gracias por tu compra!',
    orderNumber: (n: number) => `Pedido #${n}.`,
    willShip: 'Te avisaremos cuando salga tu envío.',
    downloadsTitle: 'Tus descargas',
    download: 'Descargar',
    expires: (date: string) => `Disponible hasta el ${date}`,
    subtotal: 'Subtotal',
    discount: 'Descuento',
    shipping: 'Envío',
    free: 'Gratis',
    tax: 'Impuestos',
    total: 'Total',
    taxIncluded: (amount: string) => `Incluye ${amount} de impuestos`,
    questions: (email: string) => `¿Dudas? Escríbenos a ${email}.`,
  },
  en: {
    subject: (n: number) => `Order #${n} confirmed`,
    preview: (store: string, n: number) => `Thanks for shopping at ${store}. Order #${n}.`,
    thanks: 'Thanks for your order!',
    orderNumber: (n: number) => `Order #${n}.`,
    willShip: "We'll let you know when it ships.",
    downloadsTitle: 'Your downloads',
    download: 'Download',
    expires: (date: string) => `Available until ${date}`,
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Shipping',
    free: 'Free',
    tax: 'Tax',
    total: 'Total',
    taxIncluded: (amount: string) => `Includes ${amount} in taxes`,
    questions: (email: string) => `Questions? Write to ${email}.`,
  },
} as const;
