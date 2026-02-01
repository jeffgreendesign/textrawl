# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json esbuild.config.mjs ./
COPY src/ ./src/

RUN pnpm build

# Production stage
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

COPY --from=builder /app/dist/index.js ./index.js
COPY --from=builder /app/node_modules/pdf-parse ./node_modules/pdf-parse

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080
CMD ["index.js"]
