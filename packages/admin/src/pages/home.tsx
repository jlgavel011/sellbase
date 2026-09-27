import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdmin } from '../context.js';
import { PageTitle, useSlot } from '../shell.js';
import { Badge, Button, Card, ErrorAlert, Spinner } from '../ui.js';

/** What to ask the store's AI for each pending doctor check. */
const PROMPTS: Record<string, string> = {
  payments: 'Conecta Stripe a mi tienda Sellbase y prueba la conexión.',
  email: 'Conecta Resend a mi tienda Sellbase para enviar los correos de pedidos.',
  catalog: 'Crea en Sellbase un producto activo con foto, precio y stock.',
  store: 'Configura el correo de contacto de mi tienda Sellbase.',
  webhooks: 'Configura el webhook de Stripe para mi tienda Sellbase y haz una compra de prueba.',
  schema: 'Actualiza Sellbase en mi proyecto con `sellbase upgrade`.',
};

export function HomePage() {
  const { sellbase, t } = useAdmin();
  const doctor = useQuery({
    queryKey: ['sellbase-admin', 'doctor'],
    queryFn: () => sellbase.admin.doctor(),
  });
  const top = useSlot('home.top');
  const bottom = useSlot('home.bottom');
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <>
      <PageTitle>{t.home.title}</PageTitle>
      <div className="sb:flex sb:flex-col sb:gap-6">
        {top}
        <Card
          title={t.home.checklist}
          actions={doctor.data?.ok && <Badge tone="green">{t.home.allGood}</Badge>}
        >
          {doctor.isLoading && <Spinner label={t.common.loading} />}
          <ErrorAlert error={doctor.error} />
          <ul className="sb:divide-y sb:divide-zinc-100">
            {doctor.data?.checks.map((check) => (
              <li key={check.id} className="sb:flex sb:flex-col sb:gap-1 sb:py-3">
                <div className="sb:flex sb:items-center sb:gap-2">
                  <span aria-hidden>
                    {check.status === 'ok' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}
                  </span>
                  <span className="sb:font-medium">{t.home.checks[check.id] ?? check.label}</span>
                  <span className="sb:text-sm sb:text-zinc-500">{check.message}</span>
                </div>
                {check.status !== 'ok' && (
                  <div className="sb:ml-7 sb:flex sb:flex-wrap sb:items-center sb:gap-2 sb:text-sm">
                    {check.hint && <span className="sb:text-zinc-600">{check.hint}</span>}
                    {PROMPTS[check.id] && (
                      <Button
                        variant="outline"
                        className="sb:px-2 sb:py-1 sb:text-xs"
                        onClick={() => {
                          void navigator.clipboard?.writeText(PROMPTS[check.id] ?? '');
                          setCopied(check.id);
                        }}
                      >
                        {copied === check.id ? t.home.copied : `${t.home.askAi} · ${t.home.copy}`}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {bottom}
      </div>
    </>
  );
}
