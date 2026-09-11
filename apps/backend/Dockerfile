FROM node:22-bookworm-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/types/ packages/types/
COPY packages/eslint-config/ packages/eslint-config/
COPY apps/backend/package.json apps/backend/tsconfig.json apps/backend/
COPY apps/backend/prisma/ apps/backend/prisma/
RUN pnpm --filter @siskop/backend... install --frozen-lockfile
COPY apps/backend/src/ apps/backend/src/
RUN pnpm --filter @siskop/backend db:generate && pnpm --filter @siskop/types build && pnpm --filter @siskop/backend build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-liberation tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/packages/types/ packages/types/
COPY --from=build /app/apps/backend/node_modules/ apps/backend/node_modules/
COPY --from=build /app/apps/backend/dist/ apps/backend/dist/
COPY --from=build /app/apps/backend/package.json apps/backend/
USER node
# Execute compiled imports with plain Node, the same runtime Cloud Run uses.
RUN node --input-type=module -e "const { createApp } = await import('./apps/backend/dist/app.js'); createApp();"
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/backend/dist/hosting/main.js"]
