import { createWebhooksApp } from '../webhooks.js';
import { deps } from './adapters.js';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

const app = createWebhooksApp(deps());
Deno.serve(app.fetch);
