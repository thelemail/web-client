# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS builder

ARG BUILDKIT_SBOM_SCAN_STAGE=true

WORKDIR /src

ENV CI=true

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack install

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .

RUN printf "verify-deps-before-run=false\nconfirm-modules-purge=false\n" >> .npmrc

ARG PUBLIC_API_BASE_URL
ENV PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}

ARG PUBLIC_SUBMISSION_BASE_URL
ENV PUBLIC_SUBMISSION_BASE_URL=${PUBLIC_SUBMISSION_BASE_URL}

ARG CSP_BLOB_ORIGIN=""
ENV CSP_BLOB_ORIGIN=${CSP_BLOB_ORIGIN}

RUN set -eu; \
    test -s trust-roots/directory-signing-key.asc || { echo "trust-roots/directory-signing-key.asc is missing or empty" >&2; exit 1; }; \
    test -s trust-roots/tlog-policy.json || { echo "trust-roots/tlog-policy.json is missing or empty" >&2; exit 1; }; \
    test -s trust-roots/official-sender.json || { echo "trust-roots/official-sender.json is missing or empty" >&2; exit 1; }; \
    export PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED="$(cat trust-roots/directory-signing-key.asc)"; \
    export PUBLIC_TLOG_POLICY="$(cat trust-roots/tlog-policy.json)"; \
    export PUBLIC_OFFICIAL_SENDER_POLICY="$(cat trust-roots/official-sender.json)"; \
    node scripts/check-trust-roots.mjs; \
    pnpm build && pnpm verify:bundle

ARG GIT_COMMIT=""
ARG GIT_REF=""
ARG BUILD_RUN_URL=""

RUN mkdir -p build/.well-known && \
    printf '{"commit":"%s","ref":"%s","image":"ghcr.io/thelemail/web-client","build":"%s"}\n' \
      "$GIT_COMMIT" "$GIT_REF" "$BUILD_RUN_URL" > build/.well-known/thelemail-build.json && \
    cp LICENSE build/LICENSE


FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime

COPY --from=builder /src/build /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80
