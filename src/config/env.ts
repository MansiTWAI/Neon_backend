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
    /** S3-compatible object store (Cloudflare R2, AWS S3, Supabase). Set all four to use it. */
    S3_ENDPOINT: optionalText,
    S3_BUCKET: optionalText,
    S3_ACCESS_KEY_ID: optionalText,
    S3_SECRET_ACCESS_KEY: optionalText,
    S3_REGION: z.string().default('auto'),
    /** Cloudinary keeps uploads and serves them from its CDN. Takes precedence over S3. Set all three. */
    CLOUDINARY_CLOUD_NAME: optionalText,
    CLOUDINARY_API_KEY: optionalText,
    CLOUDINARY_API_SECRET: optionalText,
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
    /** The sign-in code every number uses while WhatsApp is not connected. Ignored once it is. */
    OTP_PREVIEW_CODE: z
      .string()
      .regex(/^\d{4,6}$/, 'OTP_PREVIEW_CODE must be 4 to 6 digits')
      .default('1234'),
    META_WA_PHONE_NUMBER_ID: optionalText,
    META_WA_OTP_TEMPLATE: z.string().default('login_code'),
    META_WA_TEMPLATE_LANGUAGE: z.string().default('en'),
    META_GRAPH_API_VERSION: z.string().default('v21.0'),

    /**
     * The design assistant's model. Gemini is used when its key is set, otherwise Claude; with
     * neither, the assistant is hidden. GEMINI_MODELS is tried in order when a model is busy.
     */
    GEMINI_API_KEY: optionalText,
    GEMINI_MODELS: z
      .string()
      .default('gemini-flash-latest,gemini-3-flash-preview,gemini-3.1-flash-lite')
      .transform((value) =>
        value
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
      ),
    ANTHROPIC_API_KEY: optionalText,
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
    /** Design suggestions allowed per day across all visitors, to cap the bill. */
    ASSISTANT_DAILY_LIMIT: z.coerce.number().int().min(0).default(300),

    /**
     * The AI designer's painters, tried in order. "gemini" uses GEMINI_API_KEY and needs a billed
     * Google AI Studio project (free keys have no image quota); "cloudflare" needs
     * CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN (free daily allowance); "pollinations" allows a
     * few images without a key and more with POLLINATIONS_API_KEY.
     */
    IMAGE_PROVIDERS: z
      .string()
      .default('gemini,cloudflare,pollinations')
      .transform((value) =>
        value
          .split(',')
          .map((name) => name.trim().toLowerCase())
          .filter(Boolean),
      ),
    GEMINI_IMAGE_MODELS: z
      .string()
      .default('gemini-3.1-flash-image,gemini-2.5-flash-image')
      .transform((value) =>
        value
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
      ),
    CLOUDFLARE_ACCOUNT_ID: optionalText,
    CLOUDFLARE_AI_TOKEN: optionalText,
    POLLINATIONS_API_KEY: optionalText,
    /** Pictures the AI designer may make per day across all visitors. 0 switches it off. */
    ARTWORK_DAILY_LIMIT: z.coerce.number().int().min(0).default(150),

    FIREBASE_PROJECT_ID: optionalText,
    FIREBASE_CLIENT_EMAIL: optionalText,
    // Service-account keys are usually pasted with literal "\n" sequences.
    FIREBASE_PRIVATE_KEY: optionalText.transform((key) => key?.replace(/\\n/g, '\n')),
  })
  .superRefine((env, ctx) => {
    const s3 = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
    if (s3.some(Boolean) && !s3.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY together, or none',
      });
    }
    const cloudinary = [env.CLOUDINARY_CLOUD_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET];
    if (cloudinary.some(Boolean) && !cloudinary.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_API_SECRET'],
        message: 'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET together, or none',
      });
    }
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
