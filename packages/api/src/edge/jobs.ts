import { runJobs } from '../jobs.js';
import { deps } from './adapters.js';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const d = deps();

/** Invoked by pg_cron (via pg_net) with the service role key. */
Deno.serve(async (req) => {
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) {
    return Response.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Service role key required.',
          hint: 'Only the scheduler calls this function.',
          details: {},
        },
      },
      { status: 401 },
    );
  }
  return Response.json(await runJobs(d));
});
