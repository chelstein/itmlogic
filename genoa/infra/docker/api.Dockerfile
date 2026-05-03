# genoa-api — Express API + UI static (Node 20 alpine).
FROM node:20-alpine
WORKDIR /app

ARG GIT_COMMIT_SHA=uncommitted
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY data ./data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "src/api/server.js"]
