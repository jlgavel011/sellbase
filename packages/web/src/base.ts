import { subscribe } from './store.js';

/**
 * Theme: every element reads these CSS variables, set them on :root or on the element.
 * Fonts and text color are inherited from the page.
 *   --sellbase-primary, --sellbase-primary-text, --sellbase-text, --sellbase-muted,
 *   --sellbase-bg, --sellbase-surface, --sellbase-border, --sellbase-radius,
 *   --sellbase-danger, --sellbase-success
 * Parts (::part) can be styled from the page too: button, input, panel, line, total.
 */
export const baseCss = `
:host { display: block; color: var(--sellbase-text, inherit); font: inherit; }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: .5em; border: 0;
  border-radius: var(--sellbase-radius, 10px); padding: .75em 1.4em; cursor: pointer; font-weight: 600;
  background: var(--sellbase-primary, #111); color: var(--sellbase-primary-text, #fff); text-decoration: none; }
.btn[disabled] { opacity: .5; cursor: not-allowed; }
.btn--ghost { background: transparent; color: inherit; border: 1px solid var(--sellbase-border, #d4d4d8); }
.link { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; }
.input { width: 100%; border: 1px solid var(--sellbase-border, #d4d4d8); border-radius: calc(var(--sellbase-radius, 10px) * .6);
  padding: .6em .8em; background: var(--sellbase-bg, #fff); color: var(--sellbase-text, #111); }
label.field { display: flex; flex-direction: column; gap: .3em; font-size: .9em; }
.muted { color: var(--sellbase-muted, #6b7280); }
.danger { color: var(--sellbase-danger, #b91c1c); }
.success { color: var(--sellbase-success, #15803d); }
.small { font-size: .85em; }
.row { display: flex; justify-content: space-between; gap: 1em; }
.stack { display: flex; flex-direction: column; gap: .75em; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: .5em; }
.chip { border: 1px solid var(--sellbase-border, #d4d4d8); background: transparent; border-radius: 999px; padding: .35em 1em; cursor: pointer; }
.chip[aria-checked="true"], .chip[aria-selected="true"] { background: var(--sellbase-primary, #111); color: var(--sellbase-primary-text, #fff); border-color: transparent; }
.chip--out { text-decoration: line-through; opacity: .6; }
.skeleton { background: var(--sellbase-border, #e5e7eb); border-radius: var(--sellbase-radius, 10px); min-height: 3em; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
`;

export const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/**
 * Base for every Sellbase element: Shadow DOM (the page CSS cannot break it), one
 * re-render per state change that keeps focus and cursor, and event delegation through
 * data-action / data-input attributes.
 */
export abstract class SellbaseElement extends HTMLElement {
  protected root!: ShadowRoot;
  private unsubscribe: (() => void) | null = null;
  protected css = '';

  connectedCallback() {
    if (!this.root) {
      this.root = this.attachShadow({ mode: 'open' });
      this.root.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
        if (target && this.root.contains(target))
          this.onAction(target.dataset.action ?? '', target, e);
      });
      this.root.addEventListener('input', (e) => this.onInput(e.target as HTMLInputElement));
      this.root.addEventListener('change', (e) => this.onInput(e.target as HTMLInputElement));
      this.root.addEventListener('submit', (e) => {
        e.preventDefault();
        this.onSubmit(e.target as HTMLFormElement);
      });
      this.root.addEventListener('keydown', (e) => this.onKey(e as KeyboardEvent));
    }
    this.unsubscribe = subscribe(() => this.update());
    this.update();
    void this.load();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  /** Fetch what the element needs; call this.update() after. */
  protected async load(): Promise<void> {}
  protected abstract render(): string;
  protected onAction(_action: string, _el: HTMLElement, _e: Event) {}
  protected onInput(_el: HTMLInputElement) {}
  protected onSubmit(_form: HTMLFormElement) {}
  protected onKey(_e: KeyboardEvent) {}

  update() {
    if (!this.root) return;
    const active = this.root.activeElement as HTMLInputElement | null;
    const focusId = active?.id || active?.dataset.focus;
    const selection =
      active && 'selectionStart' in active && active.type !== 'email' && active.type !== 'number'
        ? [active.selectionStart ?? null, active.selectionEnd ?? null]
        : null;
    this.root.innerHTML = `<style>${baseCss}${this.css}</style>${this.render()}`;
    if (focusId) {
      const el =
        this.root.getElementById(focusId) ??
        this.root.querySelector<HTMLElement>(`[data-focus="${focusId.replace(/"/g, '')}"]`);
      (el as HTMLInputElement | null)?.focus();
      if (selection && el && 'setSelectionRange' in el)
        (el as HTMLInputElement).setSelectionRange(selection[0] ?? null, selection[1] ?? null);
    }
  }
}
