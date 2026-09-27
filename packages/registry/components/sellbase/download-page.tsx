'use client';

/*
 * Sellbase · download-page
 * The page a download email links to when the store sets
 * `settings.download_page_url` (e.g. https://tienda.com/descargas/{token}). It shows the
 * file, how many downloads are left and until when, and explains expired links.
 * Props: `token` (from the route, e.g. /descargas/[token]).
 * AI: brand it; keep the states (ready, expired, limit reached, invalid).
 */
import { useDownload } from '@sellbase/react';

export function DownloadPage({ token, contactHref }: { token: string; contactHref?: string }) {
  const { data, isLoading, error } = useDownload(token);
  const contact = contactHref ? (
    <a href={contactHref} className="underline">
      Escríbenos
    </a>
  ) : (
    'Escríbenos'
  );

  return (
    <section
      className="mx-auto flex max-w-md flex-col gap-4 py-12 text-center text-[var(--sb-fg)]"
      aria-live="polite"
    >
      <h1 className="text-2xl font-semibold">Tu descarga</h1>
      {isLoading && (
        <div
          className="mx-auto h-24 w-full animate-pulse rounded-[var(--sb-radius)] bg-[var(--sb-border)]"
          aria-busy="true"
        />
      )}
      {error && <p role="alert">Este enlace no es válido. {contact} y te mandamos uno nuevo.</p>}
      {data && (
        <>
          <p>
            <strong>{data.product_title}</strong>
            <span className="block text-sm text-[var(--sb-muted)]">{data.file_name}</span>
          </p>
          {data.status === 'ready' ? (
            <>
              <a
                href={data.download_url}
                className="rounded-[var(--sb-radius)] bg-[var(--sb-primary)] px-6 py-3 font-medium text-[var(--sb-primary-fg)]"
              >
                Descargar
              </a>
              <p className="text-sm text-[var(--sb-muted)]">
                {data.download_limit !== null
                  ? `Te quedan ${data.download_limit - data.downloads_used} de ${data.download_limit} descargas. `
                  : ''}
                Disponible hasta el{' '}
                {new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' }).format(
                  new Date(data.expires_at),
                )}
                .
              </p>
            </>
          ) : (
            <p role="alert">
              {data.status === 'expired'
                ? 'Este enlace ya venció.'
                : 'Ya usaste todas las descargas de este enlace.'}{' '}
              {contact} y te ayudamos.
            </p>
          )}
        </>
      )}
    </section>
  );
}
