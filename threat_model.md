# Threat Model

## Project Overview

Batchelor App is a public internet-facing pnpm monorepo that serves a shared Express 5 API plus multiple React/Vite web artifacts for the Pottery and Quilting collection apps under one domain. Users authenticate once with shared email/password or Google OAuth, then access application data stored in a shared Supabase Postgres database and private Supabase Storage buckets. Production scanning should focus on the deployed API server and the two app route trees; `artifacts/mockup-sandbox/` is development-only unless future deployment wiring exposes it.

## Assets

- **User accounts and sessions** — email addresses, bcrypt password hashes, session cookies, Google-authenticated identities, and password-reset tokens. Compromise enables full account takeover across both apps.
- **Collection data** — pottery items, quilting fabrics/patterns/quilts/layouts/shopping data, notes, categories, and derived AI metadata. This data is user-authenticated application content and must not be exposed or modifiable across trust boundaries.
- **Private images** — photos stored in private Supabase buckets for both apps. Leakage would expose private collection images and derivative metadata.
- **Application secrets** — Supabase service-role key, database credentials, session secret, OAuth client secrets, Resend credentials, and AI provider keys. Server-side secret compromise would expose all tenant data and storage.
- **AI-backed compute and outbound integrations** — OpenAI/OpenRouter/Jina/Voyage calls, password-reset email delivery, Google OAuth exchanges, and any server-side URL fetching. Abuse can create quota burn, SSRF-style internal access, or confidentiality leaks through third-party requests.

## Trust Boundaries

- **Browser to API** — all client input, uploaded images, URLs, IDs, and search/filter parameters are untrusted and cross into the Express API.
- **API to session store / database** — the API has direct write access to shared Supabase-backed state. Any injection or authorization failure can expose or corrupt both apps' data.
- **API to private object storage** — the server uses a Supabase service-role client to read/write private buckets. Access control is fully enforced in application code.
- **API to third-party services** — the server exchanges secrets with Google OAuth, Resend, OpenAI/OpenRouter/Jina/Voyage, and performs server-side URL fetches for pattern import. These integrations are high-value SSRF and data-exfiltration boundaries.
- **Public to authenticated surfaces** — health and auth entry points are public; most pottery/quilting routes are intended for authenticated users only.
- **App-to-app shared boundary** — Pottery and Quilting share one user table, one session model, and one Supabase project with namespaced tables/buckets. Cross-app access must remain intentional and never become unintended horizontal access.
- **Dev-only to production boundary** — `artifacts/mockup-sandbox/`, build outputs, and local tooling are out of production scope unless explicitly wired into the deployed artifact.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/**`
- **Highest-risk code areas**: shared auth/session/password-reset flow, private image/storage access, AI-assisted import/analysis routes, and any raw SQL or external fetch logic
- **Public surfaces**: `/api/healthz`, `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/providers`
- **Authenticated surfaces**: `/api/pottery/**`, `/api/quilting/**`, `/api/auth/me`, `/api/auth/change-password`
- **Usually dev-only**: `artifacts/mockup-sandbox/**`, generated `dist/**`, repo tooling/scripts unless they are reachable through deployed API behavior

## Threat Categories

### Spoofing

The application relies on session cookies and shared account records to identify users across both apps. All protected endpoints must require a valid server-side session, session identifiers must be regenerated on login, OAuth callbacks must validate anti-CSRF state and Google ID tokens, and password-reset flows must not allow attackers to impersonate users through token reuse or enumeration.

### Tampering

Users can submit structured JSON, uploaded images, route parameters, and externally hosted pattern URLs that influence stored records and AI-generated metadata. The server must validate all request bodies with strict schemas, enforce ownership checks on every read/write/delete path, prevent client-controlled identifiers from modifying other users' records, and ensure storage paths or AI-derived fields cannot be used to tamper with unrelated data.

### Information Disclosure

This project stores private collection data and private object-storage images behind authenticated API routes, while also holding high-value server secrets for Supabase and AI providers. API responses, image download handlers, logs, and third-party integration calls must never expose secrets, other users' records, raw password-reset artifacts, or private bucket contents. Public routes must avoid account enumeration and verbose error leakage.

### Denial of Service

The API accepts login attempts, image uploads, image-derived AI analysis, bulk re-analysis, and server-side URL imports, all of which can be abused for cost amplification or resource exhaustion. Public and authenticated expensive endpoints must be rate-limited, upload sizes and image expansion must be bounded, and outbound network requests must use strict timeouts and content limits.

### Elevation of Privilege

The highest-likelihood privilege failures are horizontal access control bugs across shared tables and private storage, plus SSRF or injection flaws that let an authenticated user pivot into server-side capabilities. Every pottery/quilting route must scope queries and storage access to the correct owner boundary, raw SQL must remain parameterized, and any server-side fetch or redirect logic must reject internal destinations and untrusted authority changes.
