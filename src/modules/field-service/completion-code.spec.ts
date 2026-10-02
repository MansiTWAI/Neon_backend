import { describe, expect, it } from 'vitest';
import { completionCode } from './completion-code';

const SECRET = 'a-test-secret-that-is-long-enough-123';

describe('completionCode', () => {
  it('is six digits and stable for a job', () => {
    const code = completionCode('0192a3b4-0000-7000-8000-000000000001', SECRET);
    expect(code).toMatch(/^\d{6}$/);
    expect(completionCode('0192a3b4-0000-7000-8000-000000000001', SECRET)).toBe(code);
  });

  it('differs between jobs and secrets', () => {
    const job = '0192a3b4-0000-7000-8000-000000000001';
    expect(completionCode(job, SECRET)).not.toBe(
      completionCode('0192a3b4-0000-7000-8000-000000000002', SECRET),
    );
    expect(completionCode(job, SECRET)).not.toBe(completionCode(job, `${SECRET}x`));
  });
});
