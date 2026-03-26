# --- Stage 1 build ---
FROM node:25-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./

ARG NPM_TOKEN
RUN if [ -n "$NPM_TOKEN" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc; fi && \
    npm ci --omit=dev --ignore-scripts && \
    rm -f .npmrc

# --- Stage 2 Prod runner ---
FROM platformatic/node-caged:25-alpine

RUN apk update && apk add --no-cache dumb-init

ENV HOME=/home/app
ENV APP_HOME=$HOME/node/
ENV NODE_ENV=production

RUN addgroup -S node && adduser -S node -G node

WORKDIR $APP_HOME

COPY --chown=node:node . $APP_HOME

COPY --chown=node:node --from=builder /build/node_modules $APP_HOME/node_modules

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["./node_modules/.bin/fastify", "start", "-a", "0.0.0.0", "-l", "info", "--options", "app.js"]