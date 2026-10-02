# Neon Adda API

NestJS 11 API on Fastify with Prisma and PostgreSQL. Serves the storefront
([Neon_customer](https://github.com/MansiTWAI/Neon_customer)), the admin panel ([Neon_admin](https://github.com/MansiTWAI/Neon_admin)), the
partner portal ([Neon_franchise](https://github.com/MansiTWAI/Neon_franchise)) and the technician app
([Neon_technician](https://github.com/MansiTWAI/Neon_technician)).

Orders are cash on delivery: they are confirmed when placed, and the technician or admin records the
cash or UPI collected. Online payment comes in a later release.

## Run locally

Node.js 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env      # fill in JWT_SECRET and ENCRYPTION_KEY, see the comments
pnpm db:local             # embedded PostgreSQL on 5433 (or: docker compose up -d)
pnpm db:deploy
pnpm db:seed
pnpm dev                  # http://localhost:4000/v1
```

The seed creates the owner admin **admin@gmail.com** / **admin123** (override with
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`).

## Sign-in codes on WhatsApp

Customers and technicians sign in with a code sent through the WhatsApp Business Cloud API. Until
`META_WA_ACCESS_TOKEN` and `META_WA_PHONE_NUMBER_ID` are set the API runs in preview mode: nothing
is sent and the code is filled in on the sign-in screen.

1. In Meta Business Suite create a WhatsApp Business app, add the business phone number and copy the
   phone number ID and a permanent access token (system user with `whatsapp_business_messaging`).
2. Create an Authentication template with a copy-code button named `login_code` (or set
   `META_WA_OTP_TEMPLATE`) and wait for approval.
3. Set both variables and restart the API.

## Deploy on Render (free)

1. Create a free PostgreSQL database at [neon.tech](https://neon.tech) and copy its **direct**
   (unpooled) connection string.
2. On Render, **New > Blueprint**, pick this repository and paste the string as `DATABASE_URL`.
   `render.yaml` creates the web service, which builds, migrates and seeds on every deploy.
   Health check: `/v1/health`.

Free-tier limits: the service sleeps after 15 minutes idle (the next request takes about a minute);
uploaded files are lost on each deploy until `S3_*` points at a bucket (Cloudflare R2 has a free tier).

## Design assistant

Set `ANTHROPIC_API_KEY` to switch on the studio's "Describe your sign" box. It uses Claude Sonnet 5.5
(`ANTHROPIC_MODEL`), allows 10 requests per visitor per hour and `ASSISTANT_DAILY_LIMIT` (300) a
day in total, and never sets prices.

## `shared/`

The pricing and commission engines and the session helpers. The storefront, the admin panel and the
API each carry the same copy, so the price a customer sees in the studio is the price the API charges.
Change it in one place and copy it to the other repositories.

## Scripts

| Command          | Does                                    |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | API in watch mode                       |
| `pnpm build`     | Production build                        |
| `pnpm test`      | Unit tests                              |
| `pnpm db:deploy` | Apply migrations                        |
| `pnpm db:seed`   | Seed reference data and the owner admin |
