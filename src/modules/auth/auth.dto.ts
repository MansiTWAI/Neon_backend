import { z } from 'zod';

/** Accepts "98123 45678", "+91 98123 45678" or "919812345678" and returns E.164. */
export const indianMobileSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'))
  .transform((digits) => `+91${digits}`);

const sixDigitCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const requestOtpSchema = z.object({ phone: indianMobileSchema });
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;

// Four digits are allowed for the fixed code used while WhatsApp is not connected.
export const verifyOtpSchema = z.object({
  phone: indianMobileSchema,
  code: z.string().regex(/^\d{4,6}$/, 'Enter the code'),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(120);

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type PasswordLoginDto = z.infer<typeof passwordLoginSchema>;

/** Customers sign in with either the email or the mobile number they registered with. */
export const customerLoginSchema = z.object({
  login: z
    .string()
    .trim()
    .min(1, 'Enter your email or mobile number')
    .max(120)
    .transform((value, ctx) => {
      if (value.includes('@')) {
        const email = emailSchema.safeParse(value);
        if (email.success) return { email: email.data };
      } else {
        const phone = indianMobileSchema.safeParse(value);
        if (phone.success) return { phone: phone.data };
      }
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email or 10-digit mobile number' });
      return z.NEVER;
    }),
  password: z.string().min(1, 'Enter your password').max(200),
});
export type CustomerLoginDto = z.infer<typeof customerLoginSchema>;

/** Long enough to resist guessing, with no composition rules that push people to predictable patterns. */
export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => value.trim().length >= 8, 'Use at least 8 characters');

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your name')
  .max(60)
  // \p{M} admits the vowel signs used by Devanagari and other Indian scripts.
  .regex(/^[\p{L}\p{M} .'-]+$/u, 'Use letters only');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: indianMobileSchema,
  password: newPasswordSchema,
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const verifyRegistrationSchema = z.object({
  challenge: z.string().min(20),
  code: z.string().regex(/^\d{4,6}$/, 'Enter the code'),
});
export type VerifyRegistrationDto = z.infer<typeof verifyRegistrationSchema>;

export const resetPasswordSchema = z.object({
  phone: indianMobileSchema,
  code: z.string().regex(/^\d{4,6}$/, 'Enter the code'),
  password: newPasswordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const secondFactorSchema = z.object({ challenge: z.string().min(20), code: sixDigitCode });
export type SecondFactorDto = z.infer<typeof secondFactorSchema>;

export const enableTwoFactorSchema = z.object({ setupToken: z.string().min(20), code: sixDigitCode });
export type EnableTwoFactorDto = z.infer<typeof enableTwoFactorSchema>;

export const updateProfileSchema = z.object({
  name: nameSchema,
  email: emailSchema.nullable().optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
