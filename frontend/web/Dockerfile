# Builds the web app and serves it with Caddy, which also forwards /api to the catalog service.
# The Caddyfile and the password file are mounted at run time (deploy/docker-compose.beta.yml).
FROM node:22-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /web/dist /srv
