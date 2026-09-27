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
- Las URLs las configura el dueño, un administrador o un token con `webhooks:write`.
- **Bloqueo de red privada (SSRF)** en `packages/api/src/net-guard.ts`. Se aplica al guardar el endpoint y otra vez antes de cada envío.
  - **Qué se bloquea:**
    - IPs de loopback, privadas, link-local (incluida `169.254.169.254`), CGNAT, multicast, reservadas y de documentación;
    - en IPv6: `::1`, `fc00::/7`, `fe80::/10`, y las IPv4 mapeadas o NAT64;
    - nombres internos: sin punto, `localhost`, `.local`, `.internal`, etc.;
    - URLs con credenciales.
  - **DNS:** el nombre siempre se resuelve (A y AAAA). Basta con que una sola dirección sea privada para rechazarlo. No se siguen redirecciones (`redirect: 'manual'`).
  - **Local:** con `SELLBASE_WEBHOOKS_ALLOW_PRIVATE=true`, que `init` solo escribe en `config.toml` del stack local, se aceptan destinos privados (p. ej. `host.docker.internal`). El nombre igual debe resolver.
  - **Doctor:** falla si la variable está activa en un proyecto con URL pública.
  - **Riesgo residual:** DNS rebinding entre la validación y la conexión. El runtime no permite fijar la IP de `fetch`. La doble validación y el no seguir redirecciones lo acotan.
