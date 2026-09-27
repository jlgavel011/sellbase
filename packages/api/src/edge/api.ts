import { createApiApp } from '../app.js';
import { deps } from './adapters.js';

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void };

const app = createApiApp(deps());
Deno.serve(app.fetch);
