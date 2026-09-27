# 0010 — Equipo, tokens de API y webhooks salientes

**Estado:** aceptada · Fase 2c · Código: `packages/api/src/handlers/team.ts`, `webhook-endpoints.ts`, `packages/api/src/webhooks-out.ts`, migración `0007_webhooks.sql`

## Equipo

- Invitar usa Supabase Auth (`inviteUserByEmail`). Si el correo ya tiene usuario, se agrega directo. El link cae en el admin (`redirect_to`), que pide crear contraseña (`type=invite` o `recovery` en el hash).
- Solo un dueño da, cambia o quita el rol de dueño. Los tokens nunca lo hacen. La tienda siempre conserva al menos un dueño.
- Todo cambio queda en `audit_log` (`team.*`).

## Tokens de API (agentes IA)

- El token se muestra una sola vez; en la base solo vive su hash (como en Fase 1).
- Por defecto trae los scopes de agente (todo menos `refunds:write`). Un token solo puede crear tokens con scopes que ya tiene, para que no pueda escalar privilegios.
- La sección "Agentes IA" es una vista de `audit_log` con `actor_type = 'token'`, con el nombre del token y las acciones de los últimos 30 días.

## Webhooks salientes

- El secreto de firma (`whsec_…`) se guarda en Vault y se muestra solo al crear el endpoint. Al borrar el endpoint, un trigger borra también el secreto.
- **Encolado:** cada evento del outbox se procesa en `runJobs` y genera una entrega por endpoint suscrito, dentro de la misma transacción. Un endpoint nunca recibe eventos anteriores a su creación. El payload incluye el objeto completo (pedido, producto o cita), igual que en la API.
- **Firma:** `Sellbase-Signature: t=<unix>,v1=<hex HMAC-SHA256(secreto, "<t>.<cuerpo>")>`, como Stripe. `verifyWebhookSignature` se exporta para los receptores.
- **Envío:** con arrendamiento (`next_attempt_at` +2 min) y `skip locked`, para que dos corridas no dupliquen. Timeout de 10 s. Una respuesta 2xx cuenta como entregada. Si falla, se reintenta a los 1, 5, 30, 120 y 720 min, y después queda `failed`.
- RLS: endpoints y entregas solo son visibles para dueños y administradores, porque los payloads traen datos de clientes.
- Scope propio `webhooks:write` (migración 0008), fuera de los scopes por defecto de agente, igual que `refunds:write`. El rol `staff` no lo tiene. Un token, además, debe mandar `confirm: true` al crear o cambiar un endpoint, porque ahí salen datos de clientes y pedidos.
- Las URLs las configura el dueño, un administrador o un token con `webhooks:write`. Hoy no se bloquean redes internas, porque en local el receptor suele ser `host.docker.internal`. **Pendiente antes de instalar en la nube (plan fase 2):** bloquear destinos privados en producción y permitirlos solo con `SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true` en local.
