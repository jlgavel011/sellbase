'use client';

import { formatMoney, type Address, type CartView, type CheckoutInput } from '@sellbase/sdk';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSellbase } from './provider.js';

const keys = {
  products: (query: object) => ['sellbase', 'products', query] as const,
  product: (slug: string) => ['sellbase', 'product', slug] as const,
  cart: (token: string | null) => ['sellbase', 'cart', token] as const,
  shipping: (token: string | null, address: unknown) =>
    ['sellbase', 'shipping', token, address] as const,
};

/** Active products. `query` accepts { q, collection, limit, cursor }. */
export function useProducts(
  query: { q?: string; collection?: string; limit?: number; cursor?: string } = {},
) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    { queryKey: keys.products(query), queryFn: () => sellbase.products.list(query) },
    queryClient,
  );
}

/** One active product with variants (price, availability) and media. */
export function useProduct(slug: string | undefined) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: keys.product(slug ?? ''),
      queryFn: () => sellbase.products.get(slug ?? ''),
      enabled: Boolean(slug),
    },
    queryClient,
  );
}

/** Opens/closes a cart drawer from anywhere (e.g. after adding a product). */
export function useCartDrawer() {
  const { cartOpen, setCartOpen } = useSellbase();
  return { open: cartOpen, setOpen: setCartOpen, toggle: () => setCartOpen(!cartOpen) };
}

/**
 * The buyer's cart. Totals always come from the server. The cart is created on the first
 * `addItem`, and forgotten once it is converted into an order.
 */
export function useCart() {
  const { sellbase, queryClient, cartToken: token, setCartToken: setToken } = useSellbase();

  const query = useQuery(
    {
      queryKey: keys.cart(token),
      queryFn: () => sellbase.cart.get(token ?? ''),
      enabled: Boolean(token),
      retry: false,
    },
    queryClient,
  );

  // Converted, expired or deleted carts start over on the next add.
  useEffect(() => {
    const status = query.data?.status;
    const missing = (query.error as { code?: string } | null)?.code === 'NOT_FOUND';
    if ((status && status !== 'open') || missing) setToken(null);
  }, [query.data?.status, query.error, setToken]);

  const store = (cart: CartView) => {
    queryClient.setQueryData(keys.cart(cart.token), cart);
    if (cart.token !== token) setToken(cart.token);
    return cart;
  };

  const ensureToken = async () => {
    if (token && query.data?.status !== 'converted') return token;
    const created = await sellbase.cart.create();
    store(created);
    return created.token;
  };

  const mutation = useMutation(
    {
      mutationFn: async (action: (t: string) => Promise<CartView>) =>
        store(await action(await ensureToken())),
    },
    queryClient,
  );
  const run = (action: (t: string) => Promise<CartView>) => mutation.mutateAsync(action);

  const cart = token ? (query.data ?? null) : null;
  return {
    cart,
    token,
    itemCount: cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0,
    isLoading: Boolean(token) && query.isLoading,
    isUpdating: mutation.isPending,
    error: (mutation.error ?? query.error) as (Error & { code?: string; hint?: string }) | null,
    /** Services need `bookingSlot` with a start time from useAvailability. */
    addItem: (
      variantId: string,
      quantity = 1,
      bookingSlot?: { starts_at: string; resource_id?: string },
    ) => run((t) => sellbase.cart.add(t, variantId, quantity, bookingSlot)),
    updateItem: (itemId: string, quantity: number) =>
      run((t) => sellbase.cart.update(t, itemId, quantity)),
    removeItem: (itemId: string) => run((t) => sellbase.cart.remove(t, itemId)),
    applyDiscount: (code: string) => run((t) => sellbase.cart.applyDiscount(t, code)),
    removeDiscount: (code: string) => run((t) => sellbase.cart.removeDiscount(t, code)),
    /** Forget the cart (e.g. on the thank-you page). */
    clear: () => setToken(null),
    format: (amount: number) => formatMoney(amount, cart?.currency ?? 'MXN'),
  };
}

/**
 * Free start times for a service variant. Times are instants: display them in the
 * returned `timezone` (the store's), not the visitor's.
 */
export function useAvailability(
  variantId: string | undefined,
  range: { from?: string; to?: string } = {},
) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: ['sellbase', 'availability', variantId, range] as const,
      queryFn: () => sellbase.availability.get(variantId ?? '', range),
      enabled: Boolean(variantId),
      staleTime: 15_000,
    },
    queryClient,
  );
}

/** Shipping options for the current cart; pass the address once the buyer typed it. */
export function useShippingRates(token: string | null, address?: Address) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: keys.shipping(token, address ?? null),
      queryFn: () => sellbase.cart.shippingRates(token ?? '', address),
      enabled: Boolean(token),
    },
    queryClient,
  );
}

/**
 * Starts checkout for the current cart and sends the buyer to pay. The order is created
 * by the payment webhook, never here.
 */
export function useCheckout() {
  const { sellbase, queryClient } = useSellbase();
  const mutation = useMutation(
    {
      mutationFn: async (input: CheckoutInput & { redirect?: boolean }) => {
        const { redirect = true, ...body } = input;
        const result = await sellbase.checkout.start(body);
        if (redirect && result.mode === 'redirect' && typeof window !== 'undefined')
          window.location.assign(result.url);
        return result;
      },
    },
    queryClient,
  );
  return {
    start: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error as (Error & { code?: string; hint?: string }) | null,
    data: mutation.data,
  };
}

/** Collections with active products (for menus and filters). */
export function useCollections() {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    { queryKey: ['sellbase', 'collections'], queryFn: () => sellbase.collections.list() },
    queryClient,
  );
}

/** One collection (title, description); list its products with useProducts({ collection }). */
export function useCollection(slug: string | undefined) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: ['sellbase', 'collection', slug],
      queryFn: () => sellbase.collections.get(slug ?? ''),
      enabled: Boolean(slug),
    },
    queryClient,
  );
}

/**
 * The checkout the buyer returns from (`?sellbase_checkout=<id>`). Polls while the
 * payment webhook has not arrived; stops once it is paid or expired.
 */
export function useCheckoutStatus(checkoutId: string | null | undefined, intervalMs = 2500) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: ['sellbase', 'checkout-status', checkoutId],
      queryFn: () => sellbase.checkout.status(checkoutId ?? ''),
      enabled: Boolean(checkoutId),
      refetchInterval: (q) => (q.state.data?.status === 'pending' ? intervalMs : false),
      retry: false,
    },
    queryClient,
  );
}

/** A buyer looks up their order with its number and the email they used. */
export function useOrderLookup() {
  const { sellbase, queryClient } = useSellbase();
  const mutation = useMutation(
    {
      mutationFn: ({ number, email }: { number: number; email: string }) =>
        sellbase.orders.lookup(number, email),
    },
    queryClient,
  );
  return {
    lookup: mutation.mutateAsync,
    order: mutation.data ?? null,
    isPending: mutation.isPending,
    error: mutation.error as (Error & { code?: string; hint?: string }) | null,
    reset: mutation.reset,
  };
}

/** A purchased file from its email link token: what it is, whether it still works, its URL. */
export function useDownload(token: string | null | undefined) {
  const { sellbase, queryClient } = useSellbase();
  return useQuery(
    {
      queryKey: ['sellbase', 'download', token],
      queryFn: () => sellbase.downloads.info(token ?? ''),
      enabled: Boolean(token),
      retry: false,
    },
    queryClient,
  );
}
