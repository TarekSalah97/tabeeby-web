import type { Config } from '../config.js';
import { log } from '../log.js';

export interface EmailProvider {
  send(to: string, subject: string, text: string): Promise<void>;
  /** When true, queued emails are marked 'skipped' instead of being sent. */
  readonly disabled?: boolean;
}

/** No email service configured: nothing is sent, and features that need email stay off. */
export class NoEmailProvider implements EmailProvider {
  readonly disabled = true;
  async send(): Promise<void> {
    /* intentionally empty */
  }
}

/** Development/test only: keeps emails in memory and logs that one was sent. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
    log.info('email (console provider)', { to, subject, text });
  }
}

/**
 * Brevo transactional email API (https://developers.brevo.com). Plain-text emails only.
 * Timeouts and non-2xx responses are errors so the outbox retries.
 */
export class BrevoEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fromName: string,
  ) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify({ sender: { email: this.fromEmail, name: this.fromName }, to: [{ email: to }], subject, textContent: text }),
      signal: AbortSignal.timeout(10_000),
    });
    // Never include the response body in errors: it can echo the recipient address.
    if (!res.ok) throw new Error(`email provider responded ${res.status}`);
  }
}

export function createEmailProvider(cfg: Config): EmailProvider {
  if (cfg.EMAIL_PROVIDER === 'brevo') return new BrevoEmailProvider(cfg.BREVO_API_KEY!, cfg.EMAIL_FROM!, cfg.EMAIL_FROM_NAME);
  if (cfg.EMAIL_PROVIDER === 'none') return new NoEmailProvider();
  return new ConsoleEmailProvider();
}
