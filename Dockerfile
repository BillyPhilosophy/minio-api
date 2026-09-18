# syntax=docker/dockerfile:1

# ---------- stage 1: build ----------
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- stage 2: runtime ----------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# 非 root 运行
RUN chown -R node:node /app
USER node

EXPOSE 3100

CMD ["node", "dist/main.js"]
