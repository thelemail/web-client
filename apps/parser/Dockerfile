# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder

ARG BUILDKIT_SBOM_SCAN_STAGE=true

WORKDIR /src

ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/parser/package.json apps/parser/
COPY packages/core/package.json packages/core/
RUN npm install -g corepack@0.36.0 && corepack enable && corepack install

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @thelemail/parser...

COPY . .

RUN printf "verify-deps-before-run=false\nconfirm-modules-purge=false\n" >> .npmrc

ARG PUBLIC_PRODUCT_ORIGINS
ENV PUBLIC_PRODUCT_ORIGINS=${PUBLIC_PRODUCT_ORIGINS}

ARG PUBLIC_PARSER_ORIGIN
ENV PUBLIC_PARSER_ORIGIN=${PUBLIC_PARSER_ORIGIN}

RUN pnpm --filter @thelemail/parser build && pnpm --filter @thelemail/parser verify:bundle

ARG GIT_COMMIT=""
ARG GIT_REF=""
ARG BUILD_RUN_URL=""

RUN mkdir -p apps/parser/build/.well-known && \
    printf '{"commit":"%s","ref":"%s","image":"ghcr.io/thelemail/parser-client","build":"%s"}\n' \
      "$GIT_COMMIT" "$GIT_REF" "$BUILD_RUN_URL" > apps/parser/build/.well-known/thelemail-build.json && \
    cp LICENSE apps/parser/build/LICENSE


FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime

COPY --from=builder /src/apps/parser/build /srv
COPY --from=builder /src/apps/parser/build-meta/csp.caddy /etc/caddy/csp.caddy
COPY caddy/parser.Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
