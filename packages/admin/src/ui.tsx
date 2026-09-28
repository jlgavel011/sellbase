import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './icons.js';

/*
 * Sellbase admin components. Visual styles live in styles.css (`sba-*` classes and the
 * design tokens); layout uses `sb:` Tailwind utilities. Nothing here leaks to the host site.
 */

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

// ── Buttons ──────────────────────────────────────────────────────────────────

/** `outline`, `ghost` and `danger` are kept as aliases of secondary, tertiary and critical. */
type ButtonVariant =
  'primary' | 'secondary' | 'tertiary' | 'critical' | 'plain' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const variantClass: Record<ButtonVariant, string> = {
  primary: 'sba-btn-primary',
  secondary: 'sba-btn-secondary',
  outline: 'sba-btn-secondary',
  tertiary: 'sba-btn-tertiary',
  ghost: 'sba-btn-tertiary',
  critical: 'sba-btn-critical',
  danger: 'sba-btn-critical',
  plain: 'sba-btn-plain',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cx(
    'sba-btn',
    variantClass[variant],
    size === 'sm' && 'sba-btn-sm',
    size === 'lg' && 'sba-btn-lg',
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClass(variant, size), !children && icon && 'sba-btn-icon', className)}
    >
      {loading ? <SpinnerDot /> : icon && <Icon name={icon} className="sb:h-4 sb:w-4" />}
      {children}
    </button>
  );
}

function SpinnerDot() {
  return (
    <span className="sb:h-3.5 sb:w-3.5 sb:animate-spin sb:rounded-full sb:border-2 sb:border-current sb:border-t-transparent" />
  );
}

// ── Form fields ──────────────────────────────────────────────────────────────

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('sba-input', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('sba-input', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('sba-input', className)} />;
}

/** Text input with a prefix or suffix inside the box ("$", "MXN", "g", "%"). */
export function InputGroup({
  prefix,
  suffix,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { prefix?: ReactNode; suffix?: ReactNode }) {
  return (
    <div className={cx('sba-input-group', className)}>
      {prefix !== undefined && <span className="sba-input-affix">{prefix}</span>}
      <input {...props} />
      {suffix !== undefined && <span className="sba-input-affix">{suffix}</span>}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
  className,
  labelHidden,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  labelHidden?: boolean;
}) {
  return (
    <label className={cx('sb:flex sb:min-w-0 sb:flex-col sb:gap-1', className)}>
      <span className={cx('sb:text-[var(--sba-text-strong)]', labelHidden && 'sb:sr-only')}>
        {label}
      </span>
      {children}
      {error && (
        <span className="sb:flex sb:items-center sb:gap-1 sb:text-xs sb:text-[var(--sba-critical)]">
          <Icon name="alert" className="sb:h-3.5 sb:w-3.5" />
          {error}
        </span>
      )}
      {hint && <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('sb:flex sb:cursor-pointer sb:items-start sb:gap-2', className)}>
      <input type="checkbox" {...props} className="sba-checkbox" />
      <span className="sb:flex sb:flex-col">
        <span className="sb:text-[var(--sba-text-strong)]">{label}</span>
        {hint && <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{hint}</span>}
      </span>
    </label>
  );
}

export function Radio({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="sb:flex sb:cursor-pointer sb:items-start sb:gap-2">
      <input type="radio" {...props} className="sba-checkbox" />
      <span className="sb:flex sb:flex-col">
        <span className="sb:text-[var(--sba-text-strong)]">{label}</span>
        {hint && <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{hint}</span>}
      </span>
    </label>
  );
}

/** On/off switch (role="switch"), for settings that apply right away or on save. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="sb:flex sb:items-start sb:justify-between sb:gap-4">
      <span className="sb:flex sb:flex-col">
        <span id={id} className="sb:text-[var(--sba-text-strong)]">
          {label}
        </span>
        {hint && <span className="sb:text-xs sb:text-[var(--sba-text-subdued)]">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        className="sba-switch sb:mt-0.5"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  title,
  actions,
  children,
  className,
  padded = true,
  subdued,
  testId,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  subdued?: boolean;
  testId?: string;
}) {
  return (
    <section
      className={cx(
        'sba-card sb:min-w-0',
        padded && 'sb:p-4',
        subdued && 'sb:bg-[var(--sba-surface-subdued)]',
        className,
      )}
      data-testid={testId}
    >
      {(title || actions) && (
        <header
          className={cx(
            'sb:flex sb:min-h-7 sb:items-center sb:justify-between sb:gap-3',
            padded ? 'sb:mb-3' : 'sb:px-4 sb:pb-2 sb:pt-4',
          )}
        >
          {title && (
            <h2 className="sb:text-sm sb:font-semibold sb:text-[var(--sba-text-strong)]">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** A divided block inside a card (full-bleed divider). */
export function CardSection({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'sb:-mx-4 sb:border-t sb:border-[var(--sba-border)] sb:px-4 sb:pt-3 sb:mt-3 first:sb:mt-0',
        className,
      )}
    >
      {title && (
        <h3 className="sb:mb-2 sb:text-xs sb:font-semibold sb:text-[var(--sba-text-strong)]">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'yellow';
const badgeTone: Record<Tone, string> = {
  neutral: '',
  green: 'sba-badge-success',
  amber: 'sba-badge-warning',
  yellow: 'sba-badge-attention',
  red: 'sba-badge-critical',
  blue: 'sba-badge-info',
};

export function Badge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: Tone;
  /** Shopify-style progress dot: 'empty' pending, 'half'/'full' done. */
  dot?: 'empty' | 'full';
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'sba-badge',
        badgeTone[tone],
        dot && 'sba-badge-dot',
        dot === 'full' && 'sba-badge-filled',
      )}
    >
      {children}
    </span>
  );
}

const bannerIcon: Record<string, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'alert',
  critical: 'alert',
};
const bannerIconColor: Record<string, string> = {
  info: 'sb:text-[#00527c]',
  success: 'sb:text-[#29845a]',
  warning: 'sb:text-[#b28400]',
  critical: 'sb:text-[#e51c00]',
};

export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  onDismiss,
}: {
  tone?: 'info' | 'success' | 'warning' | 'critical';
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cx('sba-banner', `sba-banner-${tone}`)}
    >
      <Icon
        name={bannerIcon[tone] ?? 'info'}
        className={cx('sb:h-5 sb:w-5 sb:shrink-0', bannerIconColor[tone])}
      />
      <div className="sb:flex sb:min-w-0 sb:flex-1 sb:flex-col sb:gap-1">
        {title && <p className="sb:font-semibold sb:text-[var(--sba-text-strong)]">{title}</p>}
        {children && <div className="sb:text-[var(--sba-text)]">{children}</div>}
        {actions && <div className="sb:mt-1 sb:flex sb:flex-wrap sb:gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <Button variant="tertiary" size="sm" icon="x" aria-label="Cerrar" onClick={onDismiss} />
      )}
    </div>
  );
}

/** Legacy tones (red/green/amber) mapped onto banners. */
export function Alert({
  tone = 'red',
  children,
}: {
  tone?: 'red' | 'green' | 'amber' | 'blue';
  children: ReactNode;
}) {
  const map = { red: 'critical', green: 'success', amber: 'warning', blue: 'info' } as const;
  return <Banner tone={map[tone]}>{children}</Banner>;
}

/** Shows an API error with its hint, the way agents and humans both understand it. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; hint?: string };
  return (
    <Banner tone="critical" title={e.message ?? String(error)}>
      {e.hint && <p>{e.hint}</p>}
    </Banner>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div
      className="sb:flex sb:items-center sb:justify-center sb:gap-2 sb:py-10 sb:text-[var(--sba-text-subdued)]"
      aria-busy="true"
    >
      <span className="sb:h-4 sb:w-4 sb:animate-spin sb:rounded-full sb:border-2 sb:border-[#cccccc] sb:border-t-[#303030]" />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('sba-skeleton', className ?? 'sb:h-4 sb:w-full')} aria-hidden />;
}

/** Page placeholder while a page loads: header plus two cards. */
export function PageSkeleton() {
  return (
    <div className="sb:flex sb:flex-col sb:gap-4" aria-busy="true">
      <Skeleton className="sb:h-7 sb:w-48" />
      <div className="sba-card sb:flex sb:flex-col sb:gap-3 sb:p-4">
        <Skeleton className="sb:h-4 sb:w-1/3" />
        <Skeleton />
        <Skeleton className="sb:h-4 sb:w-2/3" />
      </div>
      <div className="sba-card sb:flex sb:flex-col sb:gap-3 sb:p-4">
        <Skeleton className="sb:h-4 sb:w-1/4" />
        <Skeleton />
      </div>
    </div>
  );
}

export function Thumbnail({
  src,
  alt = '',
  size = 'md',
  icon = 'image',
}: {
  src?: string | null | undefined;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}) {
  const box =
    size === 'sm' ? 'sb:h-8 sb:w-8' : size === 'lg' ? 'sb:h-16 sb:w-16' : 'sb:h-10 sb:w-10';
  return (
    <span className={cx('sba-thumb', box)}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" />
      ) : (
        <Icon name={icon} className="sb:h-4 sb:w-4" />
      )}
    </span>
  );
}

/** Empty state with a clear next step and a copyable prompt for the owner's AI (SPEC §11). */
export function EmptyState({
  title,
  body,
  prompt,
  askAi,
  copy,
  copied,
  action,
  icon = 'sparkles',
}: {
  title: string;
  body?: string;
  prompt?: string;
  askAi?: string;
  copy?: string;
  copied?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="sb:flex sb:flex-col sb:items-center sb:gap-3 sb:px-4 sb:py-10 sb:text-center">
      <span className="sb:grid sb:h-14 sb:w-14 sb:place-items-center sb:rounded-full sb:bg-[#ecfdf5] sb:text-[var(--sba-brand-strong)]">
        <Icon name={icon} className="sb:h-7 sb:w-7" />
      </span>
      <p className="sb:text-base sb:font-semibold sb:text-[var(--sba-text-strong)]">{title}</p>
      {body && <p className="sb:max-w-md sb:text-[var(--sba-text-subdued)]">{body}</p>}
      {action && (
        <div className="sb:mt-1 sb:flex sb:flex-wrap sb:justify-center sb:gap-2">{action}</div>
      )}
      {prompt && (
        <div className="sb:mt-3 sb:w-full sb:max-w-md sb:rounded-[var(--sba-card-radius)] sb:border sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:p-3 sb:text-left">
          <p className="sb:mb-1 sb:flex sb:items-center sb:gap-1 sb:text-xs sb:font-semibold sb:text-[var(--sba-text-subdued)]">
            <Icon name="bot" className="sb:h-4 sb:w-4" />
            {askAi}
          </p>
          <p>“{prompt}”</p>
          <Button
            variant="plain"
            className="sb:mt-2 sb:text-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(prompt);
              setDone(true);
            }}
          >
            {done ? copied : copy}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('sb:overflow-x-auto', className)}>
      <table className="sba-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'sb:align-middle';

// ── Tabs ─────────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="sb:flex sb:gap-1 sb:overflow-x-auto sb:p-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="sba-tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="sb:rounded-full sb:bg-black/10 sb:px-1.5 sb:text-[0.6875rem]">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Overlays ─────────────────────────────────────────────────────────────────

/** Accessible dialog: focus moves in, Escape and the backdrop close it. */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-close])',
    );
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = size === 'sm' ? 'sb:max-w-sm' : size === 'lg' ? 'sb:max-w-3xl' : 'sb:max-w-lg';
  return (
    <div className="sba-overlay sb:fixed sb:inset-0 sb:z-50 sb:flex sb:items-end sb:justify-center sb:bg-black/45 sb:p-0 sb:sm:items-center sb:sm:p-4">
      <div aria-hidden className="sb:absolute sb:inset-0" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          'sb:relative sb:flex sb:max-h-[90vh] sb:w-full sb:flex-col sb:overflow-hidden sb:rounded-t-[var(--sba-card-radius)] sb:bg-white sb:shadow-2xl sb:outline-none sb:sm:rounded-[var(--sba-card-radius)]',
          width,
        )}
      >
        <header className="sb:flex sb:items-center sb:justify-between sb:gap-3 sb:border-b sb:border-[var(--sba-border)] sb:bg-[var(--sba-surface-subdued)] sb:px-4 sb:py-3">
          <h2 id={titleId} className="sb:text-sm sb:font-semibold sb:text-[var(--sba-text-strong)]">
            {title}
          </h2>
          <Button
            variant="tertiary"
            size="sm"
            icon="x"
            aria-label="Cerrar"
            data-close
            onClick={onClose}
          />
        </header>
        <div className="sb:flex-1 sb:overflow-y-auto sb:p-4">{children}</div>
        {footer && (
          <footer className="sb:flex sb:flex-wrap sb:justify-end sb:gap-2 sb:border-t sb:border-[var(--sba-border)] sb:px-4 sb:py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** "More actions" style menu. */
export function Menu({
  label,
  items,
  icon = 'chevronDown',
  variant = 'secondary',
  align = 'right',
  ariaLabel,
}: {
  label: ReactNode;
  ariaLabel?: string;
  items: (
    { label: ReactNode; icon?: IconName; onClick: () => void; destructive?: boolean } | false | null
  )[];
  icon?: IconName;
  variant?: ButtonVariant;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const visible = items.filter(Boolean) as Exclude<(typeof items)[number], false | null>[];
  if (visible.length === 0) return null;
  return (
    <div ref={root} className="sb:relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={buttonClass(variant)}
        onClick={() => setOpen(!open)}
      >
        {label}
        <Icon name={icon} className="sb:h-4 sb:w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={cx(
            'sb:absolute sb:z-30 sb:mt-1 sb:min-w-48 sb:rounded-[var(--sba-card-radius)] sb:bg-white sb:p-1.5 sb:shadow-[var(--sba-shadow-popover)]',
            align === 'right' ? 'sb:right-0' : 'sb:left-0',
          )}
        >
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={cx(
                'sb:flex sb:w-full sb:cursor-pointer sb:items-center sb:gap-2 sb:rounded-[var(--sba-radius)] sb:px-2 sb:py-1.5 sb:text-left sb:hover:bg-[var(--sba-surface-hover)]',
                item.destructive && 'sb:text-[var(--sba-critical)]',
              )}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon && <Icon name={item.icon} className="sb:h-4 sb:w-4" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  message: string;
  error?: boolean;
}
const ToastContext = createContext<(message: string, options?: { error?: boolean }) => void>(
  () => undefined,
);

/** Short confirmations at the bottom of the screen ("Producto guardado"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const show = useCallback((message: string, options: { error?: boolean } = {}) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((all) => [...all.slice(-2), { id, message, ...options }]);
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="sba-no-print sb:pointer-events-none sb:fixed sb:inset-x-0 sb:bottom-6 sb:z-[60] sb:flex sb:flex-col sb:items-center sb:gap-2 sb:px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'sba-toast sb:pointer-events-auto sb:flex sb:items-center sb:gap-2 sb:rounded-[var(--sba-card-radius)] sb:px-4 sb:py-2.5 sb:text-sm sb:font-medium sb:text-white sb:shadow-lg',
              t.error ? 'sb:bg-[#c70a24]' : 'sb:bg-[#1a1a1a]',
            )}
          >
            {t.error && <Icon name="alert" className="sb:h-4 sb:w-4" />}
            {t.message}
            <button
              type="button"
              aria-label="Cerrar"
              className="sb:-mr-1 sb:cursor-pointer sb:opacity-70 sb:hover:opacity-100"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <Icon name="x" className="sb:h-4 sb:w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Copy-to-clipboard button that says "Copiado" for a moment. */
export function CopyButton({
  value,
  label,
  copiedLabel,
  variant = 'secondary',
}: {
  value: string;
  label: string;
  copiedLabel: string;
  variant?: ButtonVariant;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      icon={done ? 'check' : 'copy'}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? copiedLabel : label}
    </Button>
  );
}

export function Divider() {
  return <hr className="sb:my-3 sb:border-t sb:border-[var(--sba-border)]" />;
}

export function Subdued({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('sb:text-[var(--sba-text-subdued)]', className)}>{children}</span>;
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export { cx };
