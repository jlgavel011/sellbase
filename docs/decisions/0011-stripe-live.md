# 0011 — Stripe en modo real

**Estado:** aceptada · Fase 2d · Código: `packages/adapters/src/payments/stripe.ts`, `packages/api/src/stripe-live.ts`, `handlers/store.ts`, guía `docs/guides/stripe-live.md`

- **Una sola llave activa.** El modo (`test`/`live`) sale del prefijo de la llave y se guarda en `integrations.config` junto con el estado de la cuenta (cobros y pagos habilitados, país, moneda). Cambiar de llave limpia el webhook visto y la verificación anterior.
- **Llaves live con confirmación.** `integration_connect` rechaza `sk_live_`/`rk_live_` sin `confirm: true`, para cualquier actor, porque desde ahí los clientes pagan dinero real. El admin lo pide con un paso de confirmación.
- **Webhook automático.** Con URL pública https y sin `webhook_secret` enviado, Sellbase crea el endpoint en Stripe (4 eventos de Checkout, `api_version` fija) y guarda el secreto en Vault. Si ya existe uno con la misma URL, lo borra y crea otro, porque Stripe solo muestra el secreto al crearlo. En local, o si el dueño manda su `webhook_secret`, se queda en manual con `stripe listen`.
- **Versión fija de la API** (`Stripe-Version: 2024-06-20`) en todas las llamadas y en el endpoint, para que los payloads no cambien cuando Stripe mueva la versión por defecto de la cuenta.
- **`test_purchase` nunca corre con llaves live.** Lo detiene antes del catálogo y remite a la verificación.
- **Verificación live** (`POST /integrations/stripe/live-check`, `confirm: true`): un Checkout por el mínimo de Stripe (10 MXN, 0.50 USD), sin pedido, que no aparece en ventas. El dueño lo paga. El webhook `live_check.paid` dispara el reembolso con clave idempotente y marca la integración como verificada. El resultado vive en `config.live_check` y en `audit_log`. Stripe no devuelve su comisión.
- **Doctor:**
  - En modo prueba avisa (warn); con cuenta live que no puede cobrar, falla (fail).
  - En live agrega la verificación de cobro real.
  - El check de webhooks usa `last_webhook_at` del modo actual (el `livemode` del evento), no el historial viejo de pruebas.
- **Verificado contra Stripe (modo prueba):** lectura de la cuenta; crear, reutilizar y reemplazar el endpoint del webhook (y limpiarlo); Checkout de verificación con metadata y mapeo. La prueba con dinero real necesita la llave live del dueño.
