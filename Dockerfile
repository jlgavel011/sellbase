# Sellbase MCP server (stdio) for MCP directories and catalogs (Glama, Docker MCP Catalog).
# Inside a project, `npx sellbase mcp` is the usual way to run it; this image runs the
# published package. Pass SELLBASE_URL and SELLBASE_API_TOKEN (from .env.sellbase) to use
# a store; without them the docs tools work and the rest explain how to install Sellbase.
FROM node:22-alpine
RUN npm install -g sellbase@latest && npm cache clean --force
USER node
ENTRYPOINT ["sellbase", "mcp"]
