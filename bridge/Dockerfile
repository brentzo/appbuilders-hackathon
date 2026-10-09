FROM node:24-bookworm-slim AS build

RUN apt-get update \
  && apt-get install --yes --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY protocol ./protocol
COPY bridge ./bridge
WORKDIR /repo/bridge
RUN npm ci \
  && npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim

ENV BRIDGE_HOST=0.0.0.0 \
    BRIDGE_PORT=8787 \
    BRIDGE_DATABASE_PATH=/data/bridge.sqlite

WORKDIR /app
COPY --from=build --chown=node:node /repo/bridge/dist ./dist
COPY --from=build --chown=node:node /repo/bridge/schemas ./schemas
COPY --from=build --chown=node:node /repo/bridge/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/bridge/package.json ./package.json
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.mjs"]
