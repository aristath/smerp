FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run check && npm test && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app
RUN mkdir /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY --from=build /app/public/ ./public/
COPY package.json ./package.json
COPY config.docker.json ./config.json
USER node
CMD ["node", "dist/server.js"]
