FROM node:22-bookworm-slim
WORKDIR /app
COPY infra/central-gateway/server.mjs ./server.mjs
USER node
ENV NODE_ENV=production PORT=8080
CMD ["node", "server.mjs"]
