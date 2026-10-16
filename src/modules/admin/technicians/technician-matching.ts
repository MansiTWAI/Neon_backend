import { JobStatus, Prisma } from '@prisma/client';

/** Visits that hold a technician's time. */
export const BOOKED_STATUSES: JobStatus[] = [
  'SCHEDULED',
  'RESCHEDULED',
  'ACCEPTED',
  'ON_THE_WAY',
  'REACHED',
  'WORK_STARTED',
];

/** Visits a technician has started; they cannot be taken off these. */
export const STARTED_STATUSES: JobStatus[] = ['ON_THE_WAY', 'REACHED', 'WORK_STARTED'];

/** Other visits of the technician that overlap the slot, excluding the job being scheduled. */
export function overlappingJobs(technicianId: string, start: Date, end: Date, exceptJobId?: string) {
  return {
    technicianId,
    status: { in: BOOKED_STATUSES },
    scheduledStart: { lt: end },
    scheduledEnd: { gt: start },
    ...(exceptJobId ? { id: { not: exceptJobId } } : {}),
  } satisfies Prisma.InstallationJobWhereInput;
}

export type AreaMatch = 'pincode' | 'city' | 'franchise' | 'none';

export interface CandidateFacts {
  servicePincodes: string[];
  serviceCity: string | null;
  franchiseId: string | null;
  skills: string[];
}

/** How well a technician's area covers the address: their pincodes, then their city, then the order's franchise. */
export function areaMatch(
  technician: CandidateFacts,
  address: { pincode?: string; city?: string },
  orderFranchiseId: string | null,
): AreaMatch {
  if (address.pincode && technician.servicePincodes.includes(address.pincode)) return 'pincode';
  if (
    address.city &&
    technician.serviceCity &&
    technician.serviceCity.trim().toLowerCase() === address.city.trim().toLowerCase()
  ) {
    return 'city';
  }
  if (orderFranchiseId && technician.franchiseId === orderFranchiseId) return 'franchise';
  return 'none';
}

const AREA_SCORE: Record<AreaMatch, number> = { pincode: 300, city: 200, franchise: 100, none: 0 };

/**
 * Orders candidates for a visit: free at the time first, then nearest by area, then those with the
 * installation skill, then the least busy.
 */
export function candidateScore(input: {
  area: AreaMatch;
  free: boolean;
  installs: boolean;
  openJobs: number;
}): number {
  return (
    (input.free ? 1000 : 0) +
    AREA_SCORE[input.area] +
    (input.installs ? 50 : 0) -
    Math.min(input.openJobs, 40)
  );
}

export const hasInstallSkill = (skills: string[]) =>
  skills.some((skill) => /install|fitting|mount/i.test(skill));
