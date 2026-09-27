# Cobrar de verdad con Stripe

Esta guía lleva una tienda Sellbase de modo prueba a pagos reales. Tu agente de IA puede hacer casi todo (`skills/configure-payments`), pero dos pasos son tuyos: activar la cuenta de Stripe y pagar la verificación.

## 1. Antes de empezar

- La tienda ya pasó `test_purchase` en modo prueba y `store_status` no tiene nada en rojo, salvo el aviso "Stripe en modo prueba".
- El proyecto está desplegado en Supabase con una URL pública (https). En local también se puede, con `stripe listen --live`.
- En la tienda tienes `contact_email` y `settings.site_url` (PATCH /store).

## 2. Activa tu cuenta en Stripe

En dashboard.stripe.com completa los datos del negocio, tu identificación y la cuenta bancaria. Mientras Stripe no habilite los cobros, el doctor marca **Pagos** en rojo: "cannot take charges yet".

## 3. Consigue la llave live

En dashboard.stripe.com/apikeys usa la **Secret key** (`sk_live_…`). La opción más segura es una **restricted key** (`rk_live_…`) con permiso de escritura en:

- Checkout Sessions
- Payment Intents
- Refunds
- Webhook Endpoints

y de lectura en Account.

No la guardes en archivos ni la pegues en chats: la conectas tú en el admin (paso 4) y queda cifrada en Supabase Vault.

## 4. Conecta en modo real

En el admin, **Ajustes → Pagos**: pega la llave y confirma. Conectar llaves live exige confirmación, porque a partir de ahí los clientes pagan dinero real. La llave va directo a Supabase Vault: no pasa por archivos del proyecto ni por tu agente.

- **Desplegado:** Sellbase crea el webhook en tu cuenta de Stripe (`…/functions/v1/sellbase-webhooks/stripe`, con los 4 eventos de Checkout) y guarda su secreto en Vault. Si ya existía un endpoint con esa URL, lo reemplaza, porque Stripe solo muestra el secreto una vez.
- **Local:** corre `stripe listen --live --forward-to http://127.0.0.1:54321/functions/v1/sellbase-webhooks/stripe` y conecta con el `whsec_…` que imprime.

La respuesta trae `next_steps` con lo que falta.

## 5. Verifica con un cobro real

`payments_live_check`, o el botón "Verificar cobro real" en Ajustes → Pagos, crea un Checkout por el mínimo de Stripe (10 MXN o 0.50 USD). Págalo con tu tarjeta. Cuando llega el webhook, Sellbase lo reembolsa y el doctor marca **Verificación de cobro real** en verde.

Stripe no devuelve su comisión en reembolsos: la prueba cuesta unos pocos pesos.

## 6. Qué cambia en modo real

- `test_purchase` ya no corre: nunca cobra dinero real.
- Los reembolsos desde el admin o el agente mueven dinero de verdad. Por eso exigen `confirm: true` y el permiso `refunds:write`, que los tokens de agente no traen por defecto.
- Si vuelves a llaves de prueba, los checkouts abiertos en modo real dejan de poder confirmarse. Hazlo solo en un proyecto de pruebas.

## Problemas comunes

| Síntoma en el doctor              | Qué hacer                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pagos: "cannot take charges yet"  | Termina la activación en Stripe y luego usa "Probar conexión".                                     |
| Webhooks: "no event received yet" | Revisa en Stripe → Developers → Webhooks que el endpoint esté activo. Luego corre la verificación. |
| Verificación: "refund failed"     | Reembolsa desde Stripe → Payments y vuelve a correr la verificación.                               |
| El pago no llega en local         | `stripe listen --live` debe seguir corriendo y el `whsec_` conectado debe ser el que imprimió.     |
