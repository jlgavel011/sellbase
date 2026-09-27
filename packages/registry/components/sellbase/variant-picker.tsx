'use client';

/*
 * Sellbase · variant-picker
 * One group of choices per product option (Talla, Color…), built from the variants the
 * API returns. Values with no available variant (for the other choices already made)
 * are shown crossed out; they can still be selected to see that they are sold out.
 * Props: `product`, `selected`, `onChange(selected)`. Use `pickVariant` to get the
 * variant for a selection.
 * AI: change the look (chips, swatches, dropdowns). Keep the radiogroup semantics so it
 * works with a keyboard and screen readers.
 */
import type { StorefrontProduct } from '@sellbase/react';

type Variant = StorefrontProduct['variants'][number];

/** The variant matching every selected option value, or null. */
export function pickVariant(variants: Variant[], selected: Record<string, string>) {
  if (variants.length === 1) return variants[0] ?? null;
  return (
    variants.find((v) =>
      Object.entries(selected).every(([k, val]) => v.option_values[k] === val),
    ) ?? null
  );
}

function isAvailable(
  variants: Variant[],
  selected: Record<string, string>,
  option: string,
  value: string,
) {
  const wanted = { ...selected, [option]: value };
  return variants.some(
    (v) => v.available && Object.entries(wanted).every(([k, val]) => v.option_values[k] === val),
  );
}

export function VariantPicker({
  product,
  selected,
  onChange,
}: {
  product: StorefrontProduct;
  selected: Record<string, string>;
  onChange: (selected: Record<string, string>) => void;
}) {
  if (product.options.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {product.options.map((option) => (
        <div key={option.name}>
          <p id={`sb-opt-${option.name}`} className="mb-2 text-sm font-medium">
            {option.name}
            {selected[option.name] ? (
              <span className="font-normal text-[var(--sb-muted)]">: {selected[option.name]}</span>
            ) : null}
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`sb-opt-${option.name}`}
            className="flex flex-wrap gap-2"
            onKeyDown={(e) => {
              // Arrow keys move between values, like native radio buttons.
              if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
              e.preventDefault();
              const buttons = [...e.currentTarget.querySelectorAll('button')];
              const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const i = focused >= 0 ? focused : option.values.indexOf(selected[option.name] ?? '');
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
              const n = (i + step + option.values.length) % option.values.length;
              const next = option.values[n];
              if (next) onChange({ ...selected, [option.name]: next });
              buttons[n]?.focus();
            }}
          >
            {option.values.map((value, index) => {
              const active = selected[option.name] === value;
              const available = isAvailable(product.variants, selected, option.name, value);
              const focusable = active || (!selected[option.name] && index === 0);
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={focusable ? 0 : -1}
                  aria-label={available ? value : `${value} (agotado)`}
                  onClick={() => onChange({ ...selected, [option.name]: value })}
                  className={`rounded-full border px-4 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sb-primary)] ${
                    active
                      ? 'border-[var(--sb-primary)] bg-[var(--sb-primary)] text-[var(--sb-primary-fg)]'
                      : 'border-[var(--sb-border)]'
                  } ${available ? '' : 'text-[var(--sb-muted)] line-through'}`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
