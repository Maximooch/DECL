FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim AS test

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json index.js deploy-commands.js ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data
COPY test ./test
RUN npm test

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json index.js deploy-commands.js ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "scripts/healthcheck.js"]

CMD ["npm", "start"]
