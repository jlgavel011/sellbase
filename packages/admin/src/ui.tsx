import {
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/*
 * shadcn-style primitives. Every class uses the `sb:` Tailwind prefix and the --sba-*
 * theme variables, so the admin never collides with the host site's styles.
 */

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'sb:bg-[var(--sba-primary)] sb:text-[var(--sba-primary-fg)] sb:hover:opacity-90',
  outline: 'sb:border sb:border-zinc-300 sb:bg-white sb:hover:bg-zinc-50',
  ghost: 'sb:hover:bg-zinc-100',
  danger: 'sb:bg-red-600 sb:text-white sb:hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'sb:inline-flex sb:items-center sb:justify-center sb:gap-2 sb:rounded-[var(--sba-radius)] sb:px-4 sb:py-2 sb:text-sm sb:font-medium sb:transition sb:disabled:opacity-50 sb:disabled:pointer-events-none sb:cursor-pointer',
        buttonVariants[variant],
        className,
      )}
    />
  );
}

const field =
  'sb:w-full sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-300 sb:bg-white sb:px-3 sb:py-2 sb:text-sm sb:outline-none sb:focus:border-[var(--sba-primary)] sb:focus:ring-2 sb:focus:ring-[var(--sba-primary)]/20';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(field, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(field, 'sb:min-h-24', className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(field, className)} />;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="sb:flex sb:flex-col sb:gap-1.5 sb:text-sm">
      <span className="sb:font-medium sb:text-zinc-700">{label}</span>
      {children}
      {hint && <span className="sb:text-xs sb:text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'sb:rounded-[var(--sba-radius)] sb:border sb:border-zinc-200 sb:bg-white sb:p-5',
        className,
      )}
    >
      {(title || actions) && (
        <header className="sb:mb-4 sb:flex sb:items-center sb:justify-between sb:gap-3">
          {title && <h2 className="sb:text-base sb:font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

const badgeTones = {
  neutral: 'sb:bg-zinc-100 sb:text-zinc-700',
  green: 'sb:bg-emerald-50 sb:text-emerald-700',
  amber: 'sb:bg-amber-50 sb:text-amber-800',
  red: 'sb:bg-red-50 sb:text-red-700',
  blue: 'sb:bg-sky-50 sb:text-sky-700',
};
export type Tone = keyof typeof badgeTones;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'sb:inline-flex sb:rounded-full sb:px-2 sb:py-0.5 sb:text-xs sb:font-medium',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = 'red',
  children,
}: {
  tone?: 'red' | 'green' | 'amber';
  children: ReactNode;
}) {
  const tones = {
    red: 'sb:border-red-200 sb:bg-red-50 sb:text-red-800',
    green: 'sb:border-emerald-200 sb:bg-emerald-50 sb:text-emerald-800',
    amber: 'sb:border-amber-200 sb:bg-amber-50 sb:text-amber-900',
  };
  return (
    <div
      role={tone === 'red' ? 'alert' : 'status'}
      className={cx(
        'sb:rounded-[var(--sba-radius)] sb:border sb:px-4 sb:py-3 sb:text-sm',
        tones[tone],
      )}
    >
      {children}
    </div>
  );
}

/** Shows an API error with its hint, the way agents and humans both understand it. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; hint?: string };
  return (
    <Alert>
      <p className="sb:font-medium">{e.message ?? String(error)}</p>
      {e.hint && <p className="sb:mt-1">{e.hint}</p>}
    </Alert>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div
      className="sb:flex sb:items-center sb:gap-2 sb:py-8 sb:text-sm sb:text-zinc-500"
      aria-busy="true"
    >
      <span className="sb:h-4 sb:w-4 sb:animate-spin sb:rounded-full sb:border-2 sb:border-zinc-300 sb:border-t-[var(--sba-primary)]" />
      {label}
    </div>
  );
}

/** Empty state with a copyable prompt for the store owner's AI (SPEC §11). */
export function EmptyState({
  title,
  prompt,
  askAi,
  copy,
  copied,
  action,
}: {
  title: string;
  prompt: string;
  askAi: string;
  copy: string;
  copied: string;
  action?: ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="sb:flex sb:flex-col sb:items-center sb:gap-4 sb:rounded-[var(--sba-radius)] sb:border sb:border-dashed sb:border-zinc-300 sb:p-8 sb:text-center">
      <p className="sb:text-zinc-600">{title}</p>
      {action}
      <div className="sb:w-full sb:max-w-md sb:rounded-[var(--sba-radius)] sb:bg-zinc-50 sb:p-3 sb:text-left">
        <p className="sb:mb-1 sb:text-xs sb:font-medium sb:uppercase sb:tracking-wide sb:text-zinc-500">
          {askAi}
        </p>
        <p className="sb:text-sm">“{prompt}”</p>
        <Button
          variant="ghost"
          className="sb:mt-2 sb:px-2 sb:py-1 sb:text-xs"
          onClick={() => {
            void navigator.clipboard?.writeText(prompt);
            setDone(true);
          }}
        >
          {done ? copied : copy}
        </Button>
      </div>
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="sb:overflow-x-auto">
      <table className="sb:w-full sb:text-left sb:text-sm">
        <thead className="sb:border-b sb:border-zinc-200 sb:text-xs sb:uppercase sb:tracking-wide sb:text-zinc-500">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="sb:px-3 sb:py-2 sb:font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="sb:divide-y sb:divide-zinc-100">{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'sb:px-3 sb:py-3 sb:align-middle';
export { cx };
