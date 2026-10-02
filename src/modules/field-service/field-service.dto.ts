import { z } from 'zod';

/** The steps a technician moves a visit through by hand, in order. Completion has its own route. */
export const JOB_STEPS = ['ACCEPTED', 'ON_THE_WAY', 'REACHED', 'WORK_STARTED'] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export const jobStepSchema = z.object({ to: z.enum(JOB_STEPS) });
export type JobStepDto = z.infer<typeof jobStepSchema>;

export const jobListSchema = z.object({ scope: z.enum(['upcoming', 'history']).default('upcoming') });
export type JobListQuery = z.infer<typeof jobListSchema>;

export const photoStageSchema = z.enum(['BEFORE', 'DURING', 'AFTER']);

export const completeJobSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the customer'),
  /** How the balance was settled at the door, for cash-on-delivery orders. */
  collected: z.enum(['CASH', 'UPI', 'NONE']).default('NONE'),
  notes: z.string().trim().max(1000).optional(),
});
export type CompleteJobDto = z.infer<typeof completeJobSchema>;

export const failJobSchema = z.object({
  reason: z.string().trim().min(5, 'Tell us what stopped the installation').max(500),
});
export type FailJobDto = z.infer<typeof failJobSchema>;
