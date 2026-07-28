# Node 24 is the floor: Move's persistence layer uses the built-in node:sqlite
# module, which removes the native build toolchain from the image entirely.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace @move/api --include-workspace-root

COPY apps/api apps/api

RUN npm run build --workspace @move/api


FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --omit=dev --workspace @move/api --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist

# The SQLite file lives here. Mount a volume at this path to keep saved
# destinations and push subscriptions across deploys.
RUN mkdir -p /app/data
ENV DATABASE_PATH=/app/data/move.sqlite

EXPOSE 3001

WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
