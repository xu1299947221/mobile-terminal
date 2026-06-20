FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev --workspaces

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client tmux ttyd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
  MOBILE_TERMINAL_HOST=0.0.0.0 \
  MOBILE_TERMINAL_PORT=3020 \
  MOBILE_TERMINAL_ROOT=/app \
  MOBILE_TERMINAL_DATA=/data \
  MOBILE_TERMINAL_DB=/data/app.db \
  MOBILE_TERMINAL_WEB_DIST=/app/apps/web/dist

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts ./scripts
COPY docker/entrypoint.sh /usr/local/bin/mobile-terminal-entrypoint

RUN chmod +x /usr/local/bin/mobile-terminal-entrypoint \
  && mkdir -p /data /workspace

EXPOSE 3020

ENTRYPOINT ["mobile-terminal-entrypoint"]
CMD ["npm", "run", "start", "-w", "@mobile-terminal/server"]
