# Thelemail web client

The browser client for [Thelemail](https://thelemail.com), an end-to-end encrypted email service. It is a single-page SvelteKit application that talks to the Thelemail API directly from the browser. There is no server-side rendering and no Node process in front of it: the build output is static files served by any web server.

Mail is encrypted and decrypted in the browser. Private keys are generated client-side, wrapped by a key derived from the account password, and held in a dedicated Web Worker keystore. They are never sent to the server.

## Architecture

The SPA constraint is deliberate and load-bearing. A server-rendered page would need the decryption keys on the server, which would defeat the point. Three things enforce it:

- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'` and `strict: true`
- `src/routes/+layout.ts` exports `ssr = false` and `prerender = false`, which cascade to every route
- `package.json` lists no adapter other than `adapter-static`

That means no `+page.server.ts`, no `+layout.server.ts`, no `+server.ts`, no `src/hooks.server.ts`, and no imports from `$env/static/private`, `$env/dynamic/private` or `$app/server`. Only `PUBLIC_*` environment variables exist at runtime, and they are inlined at build time.

Layout:

| Path | Contents |
| --- | --- |
| `src/lib/keystore/` | Key derivation, vault wrapping, and the Web Worker that holds unlocked keys |
| `src/lib/crypto.ts`, `src/lib/keys/` | OpenPGP key generation and management |
| `src/lib/mail/` | MIME building and parsing, rendering, sanitising, compose and reply |
| `src/lib/directory/` | Public key lookup, signature verification, transparency log proofs |
| `src/lib/api/` | HTTP client for the API and submission services |
| `src/routes/(auth)/` | Registration, login, recovery, invites |
| `src/routes/(app)/` | Mail, calendar, settings, billing, account lifecycle |

## Cryptography

| Library | Used for |
| --- | --- |
| `openpgp` | Message encryption, signing, and key handling |
| `@protontech/crypto` | OpenPGP primitives |
| `@noble/curves`, `@noble/hashes` | Curve and hash primitives |
| `@serenity-kit/opaque` | OPAQUE password-authenticated key exchange, so the password never reaches the server |
| `hash-wasm` | Argon2 key derivation |
| `@scure/bip39` | Recovery phrase encoding |
| `dompurify` | Sanitising received HTML mail before rendering |

Key lookups are verified against a signed directory and, where a transparency log policy is configured, against inclusion proofs from that log.

## Development

Requires Node 24 and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The defaults in `.env.example` point at a locally running backend. The bundled directory signing key is a development key; production builds inject the real one at build time.

```bash
pnpm check      # svelte-kit sync + svelte-check
pnpm test       # vitest
pnpm build      # static bundle into build/
pnpm preview    # serve the build
```

## Configuration

All configuration is build-time. Changing any of these requires a rebuild.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_API_BASE_URL` | Base URL of the Thelemail API |
| `PUBLIC_SUBMISSION_BASE_URL` | Base URL of the mail submission service |
| `PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED` | Armored OpenPGP public key of the directory signer. Required; the app refuses to start without it |
| `PUBLIC_TLOG_POLICY` | JSON transparency log policy (origin, verifier key, VRF key, witness threshold, `monitor` or `enforce`). Optional; log verification is skipped when unset |

Two build details that are not obvious from the source:

- `src/lib/empty-module.ts` is aliased over `core-js/stable` and `core-js/proposals/array-buffer-base64` in `vite.config.ts`, to keep a dependency's polyfills out of the bundle.
- `src/lib/mail/render/textDecoderPolyfill.ts` widens `TextDecoder` over `iconv-lite` so legacy mail charsets decode correctly.

## Docker

`Dockerfile` builds the static bundle and serves it from Caddy on port 80. The `PUBLIC_*` values are passed as build arguments.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability.

## Licence

[GNU AGPL v3](LICENSE).
