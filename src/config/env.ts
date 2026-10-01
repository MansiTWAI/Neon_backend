import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

/** Treats `KEY=` in .env the same as leaving the key out. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    /** Origin the API is reachable at from browsers, used to build file URLs. */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    /** Where uploaded files are kept when no object store is configured. */
    STORAGE_DIR: z.string().default('storage'),
    DATABASE_URL: z.string().url(),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) => value.split(',').map((origin) => origin.trim())),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** 32 bytes, base64. Encrypts two-factor secrets at rest. */
    ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'ENCRYPTION_KEY must be 32 bytes, base64',
      ),
    COOKIE_DOMAIN: optionalText,
    COOKIE_SECURE: booleanFlag,
    REQUIRE_ADMIN_2FA: booleanFlag,

    /** WhatsApp Cloud API. Without a token and phone number ID, codes are shown on screen. */
    META_WA_ACCESS_TOKEN: optionalText,
    META_WA_PHONE_NUMBER_ID: optionalText,
    META_WA_OTP_TEMPLATE: z.string().default('login_code'),
    META_WA_TEMPLATE_LANGUAGE: z.string().default('en'),
    META_GRAPH_API_VERSION: z.string().default('v21.0'),

    FIREBASE_PROJECT_ID: optionalText,
    FIREBASE_CLIENT_EMAIL: optionalText,
    // Service-account keys are usually pasted with literal "\n" sequences.
    FIREBASE_PRIVATE_KEY: optionalText.transform((key) => key?.replace(/\\n/g, '\n')),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.META_WA_ACCESS_TOKEN) !== Boolean(env.META_WA_PHONE_NUMBER_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['META_WA_PHONE_NUMBER_ID'],
        message: 'Set both META_WA_ACCESS_TOKEN and META_WA_PHONE_NUMBER_ID, or neither',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // Render publishes the service's own address, so it need not be configured twice.
  const parsed = envSchema.safeParse({
    ...raw,
    PUBLIC_API_URL: raw.PUBLIC_API_URL || raw.RENDER_EXTERNAL_URL || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
