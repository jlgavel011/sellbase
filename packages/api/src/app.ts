import { buildOpenApi } from '@sellbase/core';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Deps } from './deps.js';
import { registerBookings } from './handlers/bookings.js';
import { registerCatalog } from './handlers/catalog.js';
import { registerCatalogBulk } from './handlers/catalog-bulk.js';
import { registerCustomers } from './handlers/customers.js';
import { registerMerchandising } from './handlers/merchandising.js';
import { registerManualOrders } from './handlers/manual-order.js';
import { registerOrderActions } from './handlers/order-actions.js';
import { registerOrders } from './handlers/orders.js';
import { registerReports } from './handlers/reports.js';
import { registerStore } from './handlers/store.js';
import { registerStorefront } from './handlers/storefront.js';
import { registerTeam } from './handlers/team.js';
import { registerTestPurchase } from './handlers/test-purchase.js';
import { registerWebhookEndpoints } from './handlers/webhook-endpoints.js';
import { installErrorHandler, type AppOptions } from './http.js';

/** The public API (SPEC §7), mounted at /sellbase-api/v1 inside the Edge Function. */
export function createApiApp(deps: Deps, options: AppOptions = {}, basePath = '/sellbase-api/v1') {
  const app = new Hono().basePath(basePath);
  app.use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['authorization', 'content-type', 'idempotency-key', 'apikey', 'x-client-info'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  installErrorHandler(app);

  app.get('/openapi.json', (c) => c.json(buildOpenApi(deps.version)));
  registerStorefront(app, deps, options);
  registerCatalogBulk(app, deps, options);
  registerCatalog(app, deps, options);
  registerOrders(app, deps, options);
  registerManualOrders(app, deps, options);
  registerOrderActions(app, deps, options);
  registerBookings(app, deps, options);
  registerMerchandising(app, deps, options);
  registerCustomers(app, deps, options);
  registerReports(app, deps, options);
  registerTeam(app, deps, options);
  registerWebhookEndpoints(app, deps, options);
  registerStore(app, deps, options);
  registerTestPurchase(app, deps, options);
  return app;
}
