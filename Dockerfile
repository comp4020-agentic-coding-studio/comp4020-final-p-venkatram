# syntax = docker/dockerfile:1

# Builder: full devDependencies (astro, typescript, ...) to produce dist/.
# Not shipped in the runtime image below.
FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY astro.config.ts tsconfig.json ./
COPY src ./src
RUN pnpm build

# Runtime: prod deps only (marked, ws), the static build, the server, and the
# two things the server reads at runtime --- README.md (rendered at /readme/)
# and src/styles (inlined into that same page for a consistent theme).
# node:sqlite is built into the Node binary itself, musl included, so no
# native build toolchain is needed here for persistence.
FROM node:24-alpine AS runtime
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server ./server
COPY src/styles ./src/styles
COPY README.md ./README.md
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.ts"]
