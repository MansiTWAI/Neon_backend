export type Audience = 'customer' | 'admin' | 'franchise' | 'technician';

export const accessCookie = (audience: Audience) => `na_${audience}_at`;
export const refreshCookie = (audience: Audience) => `na_${audience}_rt`;

export interface Problem {
  status: number;
  code: string;
  title: string;
  [detail: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly details: Record<string, unknown>;

  constructor(problem: Problem) {
    super(problem.title);
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.details = problem;
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as Partial<Problem> | null;
  return new ApiError({
    ...body,
    status: res.status,
    code: body?.code ?? 'HTTP_ERROR',
    title: body?.title ?? 'Something went wrong. Please try again.',
  });
}

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: { key: string; name: string }[];
  permissions: string[];
  twoFactorEnabled: boolean;
  twoFactorSetupRequired: boolean;
  franchise: { id: string; name: string; code: string } | null;
  technician: { id: string; name: string; franchise: string | null } | null;
}
