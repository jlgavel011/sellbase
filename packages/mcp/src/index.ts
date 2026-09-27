import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSellbase } from '@sellbase/sdk';
import { createSellbaseMcpServer } from './server.js';

export { createSellbaseMcpServer } from './server.js';

/** Starts the MCP server over stdio (`npx sellbase mcp`). Logs go to stderr only. */
export async function runStdioServer(options: {
  url: string;
  token: string;
  anonKey?: string;
  version?: string;
}) {
  const sellbase = createSellbase({
    url: options.url,
    token: options.token,
    ...(options.anonKey ? { anonKey: options.anonKey } : {}),
  });
  const server = createSellbaseMcpServer(
    sellbase,
    options.version ? { version: options.version } : {},
  );
  await server.connect(new StdioServerTransport());
  console.error('[sellbase] MCP server ready on stdio');
}
