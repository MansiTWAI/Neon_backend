import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';

interface Reply {
  status(code: number): Reply;
  header(name: string, value: string): Reply;
  send(body: unknown): unknown;
}

/**
 * Serialises every error as application/problem+json. Business errors carry a stable
 * `code` the clients switch on; anything unexpected is logged and hidden from the caller.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<Reply>();
    const { status, body } = this.toProblem(exception);

    void reply
      .status(status)
      .header('content-type', 'application/problem+json')
      .send({ status, ...body });
  }

  private toProblem(exception: unknown): { status: number; body: Record<string, unknown> } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        return { status, body: response as Record<string, unknown> };
      }
      return { status, body: { code: HttpStatus[status] ?? 'ERROR', title: exception.message } };
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', title: 'Something went wrong' },
    };
  }
}
