# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json esbuild.config.mjs ./
COPY src/ ./src/

RUN pnpm build && pnpm prune --prod --ignore-scripts

# Create minimal package.json for ESM module resolution
RUN echo '{"type":"module"}' > /app/dist/package.json

# Production stage
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

COPY --from=builder /app/dist/index.js ./index.js
COPY --from=builder /app/dist/package.json ./package.json
COPY --from=builder /app/node_modules/ ./node_modules/

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080
CMD ["index.js"]
