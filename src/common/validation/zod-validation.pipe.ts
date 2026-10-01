import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      title: 'Some fields are invalid',
      errors: result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    });
  }
}
