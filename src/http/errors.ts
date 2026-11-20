/** An error whose status and message key are safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** i18n key of the user-facing message */
    readonly messageKey: string,
    internalMessage?: string,
  ) {
    super(internalMessage ?? messageKey);
    this.name = 'HttpError';
  }
}

export const notFound = () => new HttpError(404, 'error.notFound');
export const forbidden = (why?: string) => new HttpError(403, 'error.forbidden', why);
export const badRequest = (key = 'error.badRequest', why?: string) => new HttpError(400, key, why);
export const tooManyRequests = () => new HttpError(429, 'error.tooMany');
export const payloadTooLarge = () => new HttpError(413, 'error.tooLarge');

/** A domain rule was broken; the message key explains it to the user. */
export class DomainError extends Error {
  constructor(readonly messageKey: string, internal?: string) {
    super(internal ?? messageKey);
    this.name = 'DomainError';
  }
}
