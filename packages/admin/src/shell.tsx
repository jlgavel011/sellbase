import { formatMoney } from '@sellbase/sdk';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { SlotContext, SlotName } from './config.js';
import { useAdmin } from './context.js';
import { Icon, SellbaseLogo, SellbaseMark, type IconName } from './icons.js';
import { Link, useRouter } from './router.js';
import { Banner, Button, Field, Input, Menu, Thumbnail, cx } from './ui.js';

export function useSlot(name: SlotName, extra: Partial<SlotContext> = {}): ReactNode {
  const { config, sellbase } = useAdmin();
  const { navigate } = useRouter();
  return config.slots?.[name]?.({ sellbase, navigate, ...extra }) ?? null;
}

/** Store settings every page can read (cached by react-query). */
export function useStore() {
  const { sellbase } = useAdmin();
  return useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: () => sellbase.admin.store.get(),
  });
}

export function siteUrlOf(settings: unknown): string | null {
  const url = (settings as { site_url?: unknown } | undefined)?.site_url;
  return typeof url === 'string' && url ? url : null;
}

// ── Auth screens ─────────────────────────────────────────────────────────────

function AuthFrame({ children }: { children: ReactNode }) {
  const { config, sellbase, t } = useAdmin();
  // Public store info (name, logo) so the owner recognizes their store before signing in.
  const store = useQuery({
    queryKey: ['sellbase-admin', 'public-store'],
    queryFn: () => sellbase.store.get(),
    retry: false,
  });
  const logo = config.logo?.src ?? store.data?.logo_url ?? null;
  return (
    <div className="sb:grid sb:min-h-screen sb:bg-[var(--sba-bg)] sb:lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="sb:relative sb:hidden sb:overflow-hidden sb:bg-[var(--sba-frame)] sb:p-12 sb:text-white sb:lg:flex sb:lg:flex-col sb:lg:justify-between">
        <div
          aria-hidden
          className="sb:pointer-events-none sb:absolute sb:inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 10% 0%, rgba(124,107,255,.45), transparent 70%), radial-gradient(50% 45% at 100% 100%, rgba(31,184,230,.35), transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="sb:pointer-events-none sb:absolute sb:inset-0 sb:opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        <div className="sb:relative">
          <SellbaseLogo tone="light" size="lg" />
        </div>
        <div className="sb:relative sb:flex sb:max-w-md sb:flex-col sb:gap-6">
          <h2 className="sb:text-4xl sb:font-bold sb:leading-tight sb:tracking-[-0.03em]">
            {t.brand.tagline}
          </h2>
          <ul className="sb:flex sb:flex-col sb:gap-3 sb:text-[0.9375rem] sb:text-[var(--sba-frame-text)]">
            {t.brand.points.map((point, i) => (
              <li key={point} className="sb:flex sb:items-center sb:gap-3">
                <span className="sb:grid sb:h-8 sb:w-8 sb:place-items-center sb:rounded-lg sb:bg-white/10 sb:text-white">
                  <Icon
                    name={(['bot', 'store', 'shield'] as const)[i] ?? 'sparkles'}
                    className="sb:h-4 sb:w-4"
                  />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="sb:relative sb:text-xs sb:text-[var(--sba-frame-muted)]">{t.brand.footer}</p>
      </aside>
      <div className="sb:flex sb:flex-col sb:items-center sb:justify-center sb:gap-6 sb:p-4">
        <div className="sb:lg:hidden">
          <SellbaseLogo />
        </div>
        <div className="sb:flex sb:w-full sb:max-w-sm sb:flex-col sb:gap-5 sb:rounded-2xl sb:bg-white sb:p-8 sb:shadow-[var(--sba-shadow-popover)]">
          {(logo || store.data) && (
            <div className="sb:flex sb:items-center sb:gap-3">
              {logo && (
                <img
                  src={logo}
                  alt={config.logo?.alt ?? ''}
                  className="sb:h-9 sb:max-w-40 sb:object-contain"
                />
              )}
              {store.data && (
                <span className="sb:text-base sb:font-semibold sb:text-[var(--sba-text-strong)]">
                  {store.data.name}
                </span>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { supabase, t } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  }

  async function magicLink() {
    if (!email) return;
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href, shouldCreateUser: false },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <AuthFrame>
      <h1 className="sb:text-xl sb:font-semibold sb:text-[var(--sba-text-strong)]">
        {t.login.title}
      </h1>
      <form onSubmit={signIn} className="sb:flex sb:flex-col sb:gap-3">
        <Field label={t.login.email}>
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t.login.password}>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Banner tone="critical">{error}</Banner>}
        {sent && <Banner tone="success">{t.login.magicLinkSent}</Banner>}
        <Button type="submit" size="lg" disabled={busy || !password} loading={busy && !sent}>
          {t.login.signIn}
        </Button>
        <Button variant="tertiary" onClick={magicLink} disabled={busy || !email}>
          {t.login.magicLink}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** First visit from an invitation (or a reset link): choose a password. */
export function SetPassword() {
  const { supabase, t, setNeedsPassword } = useAdmin();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else {
      window.history.replaceState(null, '', window.location.pathname);
      setNeedsPassword(false);
    }
  }

  return (
    <AuthFrame>
      <div>
        <h1 className="sb:text-xl sb:font-semibold sb:text-[var(--sba-text-strong)]">
          {t.login.setPassword}
        </h1>
        <p className="sb:mt-1 sb:text-[var(--sba-text-subdued)]">{t.login.setPasswordHint}</p>
      </div>
      <form onSubmit={save} className="sb:flex sb:flex-col sb:gap-3">
        <Field label={t.login.newPassword}>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <Banner tone="critical">{error}</Banner>}
        <Button type="submit" size="lg" disabled={busy || password.length < 8}>
          {t.login.savePassword}
        </Button>
      </form>
    </AuthFrame>
  );
}

/** Blocks signed-in users who are not on the store team (the API answers 401/403). */
export function StaffGate({ children }: { children: ReactNode }) {
  const { sellbase, supabase, t, setCurrency } = useAdmin();
  const store = useQuery({
    queryKey: ['sellbase-admin', 'store'],
    queryFn: async () => {
      const s = await sellbase.admin.store.get();
      setCurrency(s.default_currency);
      return s;
    },
    retry: false,
  });
  if (store.isLoading) return <div className="sb:min-h-screen sb:bg-[var(--sba-bg)]" />;
  if (store.error) {
    return (
      <AuthFrame>
        <Banner tone="critical">{t.login.notStaff}</Banner>
        <Button variant="secondary" onClick={() => void supabase.auth.signOut()}>
          {t.nav.signOut}
        </Button>
      </AuthFrame>
    );
  }
  return <>{children}</>;
}

// ── Contextual save bar ──────────────────────────────────────────────────────

interface SaveBarState {
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
  disabled?: boolean;
}
const SaveBarContext = createContext<(state: SaveBarState | null) => void>(() => undefined);
const SaveBarStateContext = createContext<SaveBarState | null>(null);

/**
 * Shows the "Unsaved changes" bar in the top bar while `state` is set (Shopify's
 * contextual save bar), and warns before leaving the page with unsaved changes.
 */
export function useSaveBar(state: SaveBarState | null) {
  const set = useContext(SaveBarContext);
  const ref = useRef(state);
  ref.current = state;
  const active = Boolean(state);
  const saving = state?.saving;
  const disabled = state?.disabled;
  useEffect(() => {
    if (!active) {
      set(null);
      return;
    }
    set({
      onSave: () => ref.current?.onSave(),
      onDiscard: () => ref.current?.onDiscard(),
      ...(saving !== undefined ? { saving } : {}),
      ...(disabled !== undefined ? { disabled } : {}),
    });
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active, saving, disabled, set]);
  useEffect(() => () => set(null), [set]);
}

// ── Shell ────────────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: IconName | string;
  children?: { to: string; label: string }[];
}

export function Shell({ children }: { children: ReactNode }) {
  const { t, config } = useAdmin();
  const { path } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveBar, setSaveBar] = useState<SaveBarState | null>(null);
  const store = useStore();
  const sidebarBottom = useSlot('sidebar.bottom');
  const siteUrl = siteUrlOf(store.data?.settings);

  useEffect(() => setMenuOpen(false), [path]);

  const nav: NavItem[] = [
    { to: '/', label: t.nav.home, icon: 'home' },
    {
      to: '/orders',
      label: t.nav.orders,
      icon: 'orders',
      children: [{ to: '/orders/abandoned', label: t.nav2.abandoned }],
    },
    {
      to: '/products',
      label: t.nav.products,
      icon: 'products',
      children: [
        { to: '/products/collections', label: t.nav2.collections },
        { to: '/products/inventory', label: t.nav2.inventory },
      ],
    },
    { to: '/customers', label: t.nav.customers, icon: 'customers' },
    { to: '/discounts', label: t.nav.discounts, icon: 'discounts' },
    { to: '/agenda', label: t.nav.agenda, icon: 'calendar' },
    ...(config.pages ?? []).map((p) => ({
      to: `/${p.path.replace(/^\//, '')}`,
      label: p.label,
      icon: p.icon ?? '•',
    })),
  ];
  const inSection = (to: string) =>
    to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`);
  const exact = (item: NavItem) =>
    item.to === '/'
      ? path === '/'
      : inSection(item.to) && !item.children?.some((c) => inSection(c.to));

  const sidebar = (
    <nav
      className="sb:flex sb:h-full sb:flex-col sb:gap-0.5 sb:overflow-y-auto sb:px-3 sb:py-3"
      aria-label="Admin"
    >
      {nav.map((item) => (
        <div key={item.to} className="sb:flex sb:flex-col sb:gap-0.5">
          <Link
            to={item.to}
            className="sba-nav-item"
            {...(exact(item) ? { 'aria-current': 'page' as const } : {})}
          >
            {isIconName(item.icon) ? (
              <Icon name={item.icon} />
            ) : (
              <span aria-hidden className="sb:grid sb:h-5 sb:w-5 sb:place-items-center">
                {item.icon}
              </span>
            )}
            {item.label}
          </Link>
          {item.children && inSection(item.to) && (
            <div className="sb:flex sb:flex-col sb:gap-0.5">
              {item.children.map((c) => (
                <Link
                  key={c.to}
                  to={c.to}
                  className="sba-nav-sub"
                  {...(inSection(c.to) ? { 'aria-current': 'page' as const } : {})}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
      {siteUrl && (
        <>
          <p className="sb:mb-1 sb:mt-5 sb:px-2.5 sb:text-[0.6875rem] sb:font-semibold sb:uppercase sb:tracking-[0.08em] sb:text-[var(--sba-frame-muted)]">
            {t.shell.salesChannels}
          </p>
          <a href={siteUrl} target="_blank" rel="noreferrer" className="sba-nav-item">
            <Icon name="store" />
            <span className="sb:flex-1">{t.shell.onlineStore}</span>
            <Icon name="external" className="sb:h-3.5 sb:w-3.5" />
          </a>
        </>
      )}
      <div className="sb:mt-auto sb:flex sb:flex-col sb:gap-2 sb:pt-4">
        {sidebarBottom}
        <Link
          to="/settings"
          className="sba-nav-item"
          {...(inSection('/settings') ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon name="settings" />
          {t.nav.settings}
        </Link>
      </div>
    </nav>
  );

  return (
    <SaveBarContext.Provider value={setSaveBar}>
      <SaveBarStateContext.Provider value={saveBar}>
        <div className="sb:flex sb:min-h-screen sb:flex-col sb:bg-[var(--sba-frame)]">
          <TopBar onMenu={() => setMenuOpen(true)} saveBar={saveBar} />
          <div className="sb:flex sb:flex-1">
            <aside className="sba-no-print sb:sticky sb:top-14 sb:hidden sb:h-[calc(100vh-3.5rem)] sb:w-60 sb:shrink-0 sb:bg-[var(--sba-frame)] sb:md:block">
              {sidebar}
            </aside>
            {menuOpen && (
              <div className="sba-overlay sb:fixed sb:inset-0 sb:z-50 sb:md:hidden">
                <button
                  type="button"
                  aria-label={t.common.cancel}
                  className="sb:absolute sb:inset-0 sb:bg-black/50"
                  onClick={() => setMenuOpen(false)}
                />
                <aside className="sb:relative sb:h-full sb:w-72 sb:bg-[var(--sba-frame)] sb:shadow-xl">
                  {sidebar}
                </aside>
              </div>
            )}
            <main className="sb:min-w-0 sb:flex-1 sb:bg-[var(--sba-bg)] sb:px-3 sb:py-4 sb:sm:px-6 sb:md:rounded-tl-2xl sb:md:py-6">
              {children}
            </main>
          </div>
        </div>
      </SaveBarStateContext.Provider>
    </SaveBarContext.Provider>
  );
}

const ICON_NAMES = new Set([
  'home',
  'orders',
  'products',
  'customers',
  'discounts',
  'calendar',
  'settings',
  'chart',
  'store',
  'receipt',
  'bell',
  'users',
  'bot',
  'truck',
  'card',
  'mail',
  'globe',
  'tag',
  'file',
]);
const isIconName = (value: string): value is IconName => ICON_NAMES.has(value);

function TopBar({ onMenu, saveBar }: { onMenu: () => void; saveBar: SaveBarState | null }) {
  const { t, config, supabase, session } = useAdmin();
  const { navigate } = useRouter();
  const store = useStore();
  const [palette, setPalette] = useState(false);
  const siteUrl = siteUrlOf(store.data?.settings);
  const logo = config.logo?.src ?? store.data?.logo_url ?? null;
  const name = store.data?.name ?? '';
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(target.tagName) || target.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sba-no-print sb:sticky sb:top-0 sb:z-40 sb:flex sb:h-14 sb:items-center sb:gap-3 sb:bg-[var(--sba-frame)] sb:px-3 sb:text-white sb:sm:px-4">
      <button
        type="button"
        className="sb:grid sb:h-9 sb:w-9 sb:cursor-pointer sb:place-items-center sb:rounded-lg sb:hover:bg-white/10 sb:md:hidden"
        aria-label={t.common.menu}
        onClick={onMenu}
      >
        <Icon name="menu" />
      </button>
      <Link to="/" className="sb:flex sb:items-center sb:md:w-52 sb:md:pl-1">
        <SellbaseLogo tone="light" />
      </Link>
      {saveBar ? (
        <div
          className="sb:flex sb:flex-1 sb:items-center sb:justify-between sb:gap-3"
          role="region"
          aria-label={t.shell.unsaved}
        >
          <span className="sb:flex sb:items-center sb:gap-2 sb:font-semibold">
            <span className="sb:h-2 sb:w-2 sb:animate-pulse sb:rounded-full sb:bg-amber-400" />
            {t.shell.unsaved}
          </span>
          <div className="sb:flex sb:gap-2">
            <button
              type="button"
              className="sba-btn sb:bg-white/10 sb:text-white sb:hover:bg-white/20"
              onClick={saveBar.onDiscard}
              disabled={saveBar.saving}
            >
              {t.shell.discard}
            </button>
            <button
              type="button"
              className="sba-btn sb:bg-white sb:text-[var(--sba-text-strong)] sb:hover:bg-[#eef0fe]"
              onClick={saveBar.onSave}
              disabled={saveBar.saving || saveBar.disabled}
              aria-busy={saveBar.saving || undefined}
            >
              {t.shell.save}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sb:flex sb:flex-1 sb:justify-center">
            <button
              type="button"
              onClick={() => setPalette(true)}
              aria-label={t.shell.searchLabel}
              className="sb:flex sb:h-9 sb:w-full sb:max-w-xl sb:cursor-pointer sb:items-center sb:gap-2 sb:rounded-xl sb:border sb:border-white/10 sb:bg-white/[0.06] sb:px-3 sb:text-left sb:text-[var(--sba-frame-text)] sb:transition sb:hover:border-white/20 sb:hover:bg-white/10"
            >
              <Icon name="search" className="sb:h-4 sb:w-4" />
              <span className="sb:flex-1 sb:truncate">{t.palette.trigger}</span>
              <span className="sb:hidden sb:items-center sb:gap-1 sb:sm:flex">
                <kbd className="sba-kbd">⌘</kbd>
                <kbd className="sba-kbd">K</kbd>
              </span>
            </button>
          </div>
          <Menu
            variant="tertiary"
            ariaLabel={t.shell.account}
            label={
              <span className="sb:flex sb:items-center sb:gap-2 sb:text-white">
                <span className="sb:grid sb:h-7 sb:w-7 sb:place-items-center sb:overflow-hidden sb:rounded-lg sb:bg-[image:var(--sba-gradient)] sb:text-xs sb:font-bold sb:text-white">
                  {logo ? (
                    <img
                      src={logo}
                      alt=""
                      className="sb:h-full sb:w-full sb:bg-white sb:object-contain"
                    />
                  ) : (
                    initials || 'S'
                  )}
                </span>
                <span className="sb:hidden sb:max-w-40 sb:truncate sb:lg:inline">{name}</span>
              </span>
            }
            icon="chevronDown"
            items={[
              siteUrl
                ? {
                    label: t.shell.viewStore,
                    icon: 'external' as const,
                    onClick: () => void window.open(siteUrl, '_blank', 'noopener'),
                  }
                : null,
              {
                label: t.nav.settings,
                icon: 'settings' as const,
                onClick: () => navigate('/settings'),
              },
              {
                label: (
                  <span className="sb:flex sb:flex-col">
                    {t.nav.signOut}
                    <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">
                      {session?.user.email}
                    </span>
                  </span>
                ),
                icon: 'logout' as const,
                onClick: () => void supabase.auth.signOut(),
              },
            ]}
          />
        </>
      )}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </header>
  );
}

interface PaletteItem {
  id: string;
  group: string;
  label: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  thumb?: string | null;
  run: () => void;
}

/**
 * Command palette (⌘K, Ctrl+K or "/"): jump anywhere, run common actions and search
 * products, orders and customers. Arrow keys move, Enter runs, Escape closes.
 */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const { sellbase, t, config } = useAdmin();
  const { navigate } = useRouter();
  const store = useStore();
  const siteUrl = siteUrlOf(store.data?.settings);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const locale = config.locale === 'en' ? 'en-US' : 'es-MX';
  const p = t.palette;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);

  const results = useQuery({
    queryKey: ['sellbase-admin', 'search', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const [products, orders, customers] = await Promise.all([
        sellbase.admin.products.search({ q: term, limit: 5 }).catch(() => ({ data: [] })),
        sellbase.admin.orders
          .search({ q: term.replace(/^#/, ''), limit: 5 })
          .catch(() => ({ data: [] })),
        sellbase.admin.customers.search({ q: term, limit: 5 }).catch(() => ({ data: [] })),
      ]);
      return { products: products.data, orders: orders.data, customers: customers.data };
    },
  });

  const go = (to: string) => () => {
    onClose();
    navigate(to);
  };
  const actions: PaletteItem[] = [
    {
      id: 'new-product',
      group: p.actions,
      label: p.newProduct,
      icon: 'plus',
      run: go('/products/new'),
    },
    {
      id: 'new-order',
      group: p.actions,
      label: p.newOrder,
      icon: 'receipt',
      run: go('/orders/new'),
    },
    {
      id: 'new-discount',
      group: p.actions,
      label: p.newDiscount,
      icon: 'discounts',
      run: go('/discounts'),
    },
    { id: 'to-fulfill', group: p.goTo, label: p.toFulfill, icon: 'orders', run: go('/orders') },
    {
      id: 'abandoned',
      group: p.goTo,
      label: t.nav2.abandoned,
      icon: 'cart',
      run: go('/orders/abandoned'),
    },
    {
      id: 'inventory',
      group: p.goTo,
      label: t.nav2.inventory,
      icon: 'inventory',
      run: go('/products/inventory'),
    },
    {
      id: 'customers',
      group: p.goTo,
      label: t.nav.customers,
      icon: 'customers',
      run: go('/customers'),
    },
    {
      id: 'payments',
      group: p.goTo,
      label: p.payments,
      icon: 'card',
      run: go('/settings/payments'),
    },
    {
      id: 'shipping',
      group: p.goTo,
      label: p.shipping,
      icon: 'truck',
      run: go('/settings/shipping'),
    },
    { id: 'agents', group: p.goTo, label: p.agents, icon: 'bot', run: go('/settings/agents') },
    ...(siteUrl
      ? [
          {
            id: 'store',
            group: p.goTo,
            label: t.shell.viewStore,
            icon: 'external' as const,
            run: () => {
              onClose();
              window.open(siteUrl, '_blank', 'noopener');
            },
          },
        ]
      : []),
  ];
  const needle = q.trim().toLowerCase();
  const matching = needle
    ? actions.filter((a) => String(a.label).toLowerCase().includes(needle))
    : actions;
  const r = results.data;
  const found: PaletteItem[] =
    term.length >= 2 && r
      ? [
          ...r.products.map((x) => ({
            id: `p-${x.id}`,
            group: t.shell.groups.products,
            label: x.title,
            thumb: x.media[0]?.url ?? null,
            run: go(`/products/${x.id}`),
          })),
          ...r.orders.map((o) => ({
            id: `o-${o.id}`,
            group: t.shell.groups.orders,
            label: `#${o.number}`,
            hint: `${o.email} · ${formatMoney(o.total_amount, o.currency, locale)}`,
            icon: 'orders' as const,
            run: go(`/orders/${o.id}`),
          })),
          ...r.customers.map((c) => ({
            id: `c-${c.id}`,
            group: t.shell.groups.customers,
            label: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            hint: c.email,
            icon: 'customers' as const,
            run: go(`/customers/${c.id}`),
          })),
        ]
      : [];
  const items = [...found, ...matching];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[current]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let lastGroup = '';
  return (
    <div className="sba-overlay sb:fixed sb:inset-0 sb:z-[70] sb:flex sb:items-start sb:justify-center sb:bg-[#0d0c1d]/55 sb:p-4 sb:pt-[12vh] sb:text-[var(--sba-text)] sb:backdrop-blur-sm">
      <div aria-hidden className="sb:absolute sb:inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.title}
        className="sb:relative sb:flex sb:max-h-[70vh] sb:w-full sb:max-w-xl sb:flex-col sb:overflow-hidden sb:rounded-2xl sb:bg-white sb:shadow-[var(--sba-shadow-popover)]"
        onKeyDown={onKeyDown}
      >
        <div className="sb:flex sb:items-center sb:gap-3 sb:border-b sb:border-[var(--sba-border)] sb:px-4">
          <Icon name="search" className="sb:h-5 sb:w-5 sb:text-[var(--sba-brand)]" />
          <input
            ref={input}
            type="text"
            value={q}
            placeholder={p.placeholder}
            aria-label={t.shell.searchLabel}
            className="sb:h-14 sb:flex-1 sb:border-0 sb:bg-transparent sb:text-[0.9375rem] sb:text-[var(--sba-text-strong)] sb:outline-none sb:placeholder:text-[#9a9db2]"
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
          />
          <kbd className="sba-kbd sb:text-[var(--sba-text-subdued)]">esc</kbd>
        </div>
        <div
          ref={list}
          role="listbox"
          aria-label={p.title}
          className="sb:flex-1 sb:overflow-y-auto sb:p-2"
        >
          {results.isFetching && term.length >= 2 && (
            <p className="sb:px-3 sb:py-2 sb:text-xs sb:text-[var(--sba-text-subdued)]">
              {t.shell.searching}
            </p>
          )}
          {items.length === 0 && !results.isFetching && (
            <p className="sb:px-3 sb:py-6 sb:text-center sb:text-[var(--sba-text-subdued)]">
              {t.shell.noResults}
            </p>
          )}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <p className="sb:px-3 sb:pb-1 sb:pt-3 sb:text-[0.6875rem] sb:font-semibold sb:uppercase sb:tracking-[0.06em] sb:text-[var(--sba-text-subdued)]">
                    {header}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                  className={cx(
                    'sb:flex sb:w-full sb:cursor-pointer sb:items-center sb:gap-3 sb:rounded-xl sb:px-3 sb:py-2 sb:text-left',
                    i === current && 'sb:bg-[var(--sba-brand-soft)]',
                  )}
                >
                  {item.thumb !== undefined ? (
                    <Thumbnail src={item.thumb} size="sm" />
                  ) : (
                    <span
                      className={cx(
                        'sb:grid sb:h-8 sb:w-8 sb:shrink-0 sb:place-items-center sb:rounded-lg',
                        i === current
                          ? 'sb:bg-[image:var(--sba-gradient)] sb:text-white'
                          : 'sb:bg-[var(--sba-surface-subdued)] sb:text-[var(--sba-text-subdued)]',
                      )}
                    >
                      <Icon name={item.icon ?? 'arrowRight'} className="sb:h-4 sb:w-4" />
                    </span>
                  )}
                  <span className="sb:flex sb:min-w-0 sb:flex-1 sb:flex-col">
                    <span className="sb:truncate sb:font-semibold sb:text-[var(--sba-text-strong)]">
                      {item.label}
                    </span>
                    {item.hint && (
                      <span className="sb:truncate sb:text-xs sb:text-[var(--sba-text-subdued)]">
                        {item.hint}
                      </span>
                    )}
                  </span>
                  {i === current && (
                    <Icon name="enter" className="sb:h-4 sb:w-4 sb:text-[var(--sba-brand)]" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="sb:flex sb:items-center sb:gap-4 sb:border-t sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:px-4 sb:py-2 sb:text-xs sb:text-[var(--sba-text-subdued)]">
          <span className="sb:flex sb:items-center sb:gap-1">
            <kbd className="sba-kbd">↑</kbd>
            <kbd className="sba-kbd">↓</kbd> {p.move}
          </span>
          <span className="sb:flex sb:items-center sb:gap-1">
            <kbd className="sba-kbd">↵</kbd> {p.open}
          </span>
          <span className="sb:ml-auto sb:flex sb:items-center sb:gap-1.5">
            <SellbaseMark className="sb:h-4 sb:w-4" />
            Sellbase
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Page layout ──────────────────────────────────────────────────────────────

/**
 * Page frame: back link, title with badges, actions on the right. `width` narrow for
 * settings-like pages, wide for tables.
 */
export function Page({
  title,
  backTo,
  backLabel,
  badges,
  subtitle,
  actions,
  children,
  width = 'default',
}: {
  title: ReactNode;
  backTo?: string;
  backLabel?: string;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
}) {
  const max =
    width === 'narrow'
      ? 'sb:max-w-3xl'
      : width === 'wide'
        ? 'sb:max-w-[76rem]'
        : 'sb:max-w-[62rem]';
  return (
    <div className={cx('sb:mx-auto sb:flex sb:w-full sb:flex-col sb:gap-4', max)}>
      <div className="sb:flex sb:flex-wrap sb:items-start sb:justify-between sb:gap-3">
        <div className="sb:flex sb:min-w-0 sb:items-start sb:gap-2">
          {backTo && (
            <Link
              to={backTo}
              className="sba-btn sba-btn-tertiary sba-btn-icon sb:-ml-1 sb:mt-[-2px] sba-no-print"
            >
              <Icon name="arrowLeft" className="sb:h-4 sb:w-4" />
              <span className="sb:sr-only">{backLabel}</span>
            </Link>
          )}
          <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-0.5">
            <div className="sb:flex sb:flex-wrap sb:items-center sb:gap-2">
              <h1 className="sb:text-xl sb:font-bold sb:tracking-tight sb:text-[var(--sba-text-strong)]">
                {title}
              </h1>
              {badges}
            </div>
            {subtitle && <p className="sb:text-[var(--sba-text-subdued)]">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="sba-no-print sb:flex sb:flex-wrap sb:items-center sb:gap-2">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** Two columns on large screens: main content and a narrower aside (Shopify's 2/3 + 1/3). */
export function Layout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="sb:grid sb:items-start sb:gap-4 sb:lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-4">{children}</div>
      {aside && <div className="sb:flex sb:min-w-0 sb:flex-col sb:gap-4">{aside}</div>}
    </div>
  );
}

/** Kept for pages and extensions that use the older header. */
export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sb:mx-auto sb:mb-4 sb:flex sb:w-full sb:max-w-[62rem] sb:flex-wrap sb:items-center sb:justify-between sb:gap-3">
      <h1 className="sb:text-xl sb:font-bold sb:tracking-tight sb:text-[var(--sba-text-strong)]">
        {children}
      </h1>
      {actions}
    </div>
  );
}

/** Legacy pages render inside this so they share the page width. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="sb:mx-auto sb:flex sb:w-full sb:max-w-[62rem] sb:flex-col sb:gap-4">
      {children}
    </div>
  );
}

export const useSaveBarActive = () => useContext(SaveBarStateContext) !== null;
