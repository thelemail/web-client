# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /src

ENV CI=true

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .

RUN printf "verify-deps-before-run=false\nconfirm-modules-purge=false\n" >> .npmrc

ARG PUBLIC_API_BASE_URL
ENV PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}

ARG PUBLIC_SUBMISSION_BASE_URL
ENV PUBLIC_SUBMISSION_BASE_URL=${PUBLIC_SUBMISSION_BASE_URL}

ARG PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED_B64=""
ARG PUBLIC_TLOG_POLICY_B64=""

RUN if [ -n "$PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED_B64" ]; then \
      export PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED="$(echo "$PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED_B64" | base64 -d)"; \
    fi; \
    if [ -n "$PUBLIC_TLOG_POLICY_B64" ]; then \
      export PUBLIC_TLOG_POLICY="$(echo "$PUBLIC_TLOG_POLICY_B64" | base64 -d)"; \
    fi; \
    pnpm build


FROM caddy:2-alpine AS runtime

COPY --from=builder /src/build /srv

RUN printf ':80 {\n\troot * /srv\n\ttry_files {path} /index.html\n\tfile_server\n\tencode zstd gzip\n}\n' > /etc/caddy/Caddyfile

EXPOSE 80
