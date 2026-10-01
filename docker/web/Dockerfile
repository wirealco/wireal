# The Wireal web app, built for one API origin and served by nginx.
#
#   docker build -f docker/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t wireal-web .
#
# The API origin is compiled into the bundle and its Content-Security-Policy,
# so changing it means rebuilding this image (docker compose up -d --build).

FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Install scripts only build the runner's native terminal (node-pty), which the
# web app never loads; esbuild and Tailwind take their binaries from optional
# dependencies without them.
RUN npm ci --ignore-scripts
COPY . .
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "Pass --build-arg VITE_API_URL=https://<api host>" && exit 1)
ENV VITE_API_URL=$VITE_API_URL
# The MCP address the docs page and the landing page show; the hosted one when unset.
ARG VITE_MCP_URL
ENV VITE_MCP_URL=$VITE_MCP_URL
RUN npm run build && mkdir -p /out && node docker/web/headers-to-nginx.mjs dist/_headers /out && rm dist/_headers

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out/headers.conf /out/assets.conf /etc/nginx/wireal/
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 8080
