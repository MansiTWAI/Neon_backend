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

export const verifyOtpSchema = z.object({ phone: indianMobileSchema, code: sixDigitCode });
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const passwordLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(200),
});
export type PasswordLoginDto = z.infer<typeof passwordLoginSchema>;

export const secondFactorSchema = z.object({ challenge: z.string().min(20), code: sixDigitCode });
export type SecondFactorDto = z.infer<typeof secondFactorSchema>;

export const enableTwoFactorSchema = z.object({ setupToken: z.string().min(20), code: sixDigitCode });
export type EnableTwoFactorDto = z.infer<typeof enableTwoFactorSchema>;

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Enter your name')
    .max(60)
    // \p{M} admits the vowel signs used by Devanagari and other Indian scripts.
    .regex(/^[\p{L}\p{M} .'-]+$/u, 'Use letters only'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').nullable().optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
