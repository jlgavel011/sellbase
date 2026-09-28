import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSellbase } from '@sellbase/sdk';
import { createSellbaseMcpServer } from './server.js';

export { createSellbaseMcpServer } from './server.js';

/** Starts the MCP server over stdio (`npx sellbase mcp`). Logs go to stderr only. */
const NOT_INSTALLED = {
  error: {
    code: 'VALIDATION_ERROR',
    message:
      'Sellbase is not installed in this project yet (no .env.sellbase and no SELLBASE_URL / SELLBASE_API_TOKEN).',
    hint: 'Run `npx sellbase init --yes` in the project root (local Supabase, or --supabase-url … for a hosted project), then restart the MCP server. docs_search works meanwhile.',
    details: {},
  },
};

/**
 * Starts the MCP server on stdio. Without credentials (e.g. installed as a Claude Code
 * plugin in a project that has no Sellbase yet) it still starts: docs tools work and
 * every store tool answers with the command that installs Sellbase.
 */
export async function runStdioServer(options: {
  url?: string | undefined;
  token?: string | undefined;
  anonKey?: string;
  version?: string;
}) {
  const configured = Boolean(options.url && options.token);
  const sellbase = configured
    ? createSellbase({
        url: options.url ?? '',
        token: options.token ?? '',
        ...(options.anonKey ? { anonKey: options.anonKey } : {}),
      })
    : createSellbase({
        url: 'https://sellbase.invalid',
        fetch: async () => new Response(JSON.stringify(NOT_INSTALLED), { status: 503 }),
      });
  const server = createSellbaseMcpServer(
    sellbase,
    options.version ? { version: options.version } : {},
  );
  await server.connect(new StdioServerTransport());
  console.error(
    configured
      ? '[sellbase] MCP server ready on stdio'
      : '[sellbase] MCP server ready (not installed in this project: run `npx sellbase init`)',
  );
}
