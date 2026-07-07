# Authentication & Security

This document covers the auth/security layer: JWT login, role-based access
control (RBAC), password reset, CORS, and rate limiting.

## Required environment variables

Add these to `backend/.env` (and `.env.test` / production env as appropriate):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | **yes** | — | Secret used to sign/verify access tokens. **Must be ≥ 32 characters.** The server refuses to sign or verify tokens if unset. |
| `ALLOWED_ORIGINS` | recommended | localhost dev origins | Comma-separated CORS allowlist, e.g. `https://app.housexpert.com,http://localhost:5173`. Replaces the old wildcard `*`. |
| `ACCESS_TOKEN_TTL_HOURS` | no | `24` | Access-token lifetime in hours. |
| `AUTH_EXPOSE_RESET_TOKEN` | no (dev only) | unset | When `true`, `/auth/forgot-password` returns the raw reset token in its JSON response (for testing before email is wired). **Never enable in production.** |

Generate a strong secret:

```sh
openssl rand -hex 32
```

## Bootstrapping the first user

There is no public sign-up. Create the first `super_admin` with the seed script:

```sh
cd backend
SEED_ADMIN_EMAIL=admin@housexpert.com \
SEED_ADMIN_PASSWORD=changeme123 \
SEED_ADMIN_NAME="Super Admin" \
go run ./cmd/seed
```

Re-running with an existing email is a safe no-op. After that, admins create
further users through `POST /api/v1/auth/register`.

## Endpoints

Public (no token needed):

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | `{email, password}` | Rate-limited: 10/min per IP. Returns access + refresh tokens + user. |
| POST | `/api/v1/auth/refresh` | `{refresh_token}` | Rotates the refresh token (old one is revoked). |
| POST | `/api/v1/auth/logout` | `{refresh_token}` | Revokes the session. |
| POST | `/api/v1/auth/forgot-password` | `{email}` | Always returns success (no account enumeration). |
| POST | `/api/v1/auth/reset-password` | `{token, new_password}` | Revokes all sessions on success. |

Protected (valid `Authorization: Bearer <access_token>` required):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/auth/me` | Current user. |
| POST | `/api/v1/auth/register` | **admin / super_admin only.** Creates a user. |
| * | all other `/api/v1/*` routes | Require a valid token. `DELETE` requests additionally require **manager / admin / super_admin** (RBAC). |

## Security design notes

- **Passwords** are hashed with bcrypt (cost 12); plaintext is never stored. Policy: ≥ 8 chars, at least one letter and one digit.
- **Access tokens** are short-lived HS256 JWTs. The middleware rejects any non-HMAC algorithm to prevent `alg` confusion attacks.
- **Refresh tokens** are opaque random values, stored only as SHA-256 hashes, with a TTL index so MongoDB auto-purges expired sessions. Rotation on refresh limits the blast radius of a stolen token.
- **Login responses** are identical for "no such user" and "wrong password" to prevent account enumeration.
- **CORS** echoes the request origin only when it's in `ALLOWED_ORIGINS` — no wildcard.
- **Rate limiting** throttles login attempts per IP to blunt brute-force.

## Roles (RBAC)

`super_admin` → `admin` → `manager` → `sales` → `designer`. Roles are carried
in the JWT and enforced via `middleware.RequireRole(...)` and
`middleware.RequireRoleForMethods(...)`.
