# The Wireal MCP server as a Node process (docker/mcp/server.ts), for hosts
# that do not run it on Cloudflare Workers.
#
#   docker build -f docker/mcp/Dockerfile -t wireal-mcp .

FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
# One file with its dependencies inside; the banner gives bundled CommonJS
# modules the `require` an ES module does not have.
RUN npx esbuild docker/mcp/server.ts --bundle --platform=node --target=node22 --format=esm \
      --outfile=/out/server.mjs \
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /out/server.mjs ./
ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
