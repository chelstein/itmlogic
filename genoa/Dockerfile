# Genoa — propagation studio service.
# Multi-stage Node 20 alpine image for Digital Ocean App Platform.
FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY public ./public
COPY db ./db
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
