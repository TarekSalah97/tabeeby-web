import type { Config } from '../config.js';
import { log } from '../log.js';

export interface SmsProvider {
  send(toE164: string, body: string): Promise<void>;
  /** When true, queued messages are marked 'skipped' instead of being sent. */
  readonly disabled?: boolean;
}

/** No SMS provider configured: nothing is sent. */
export class NoSmsProvider implements SmsProvider {
  readonly disabled = true;
  async send(): Promise<void> {
    /* intentionally empty */
  }
}

/** Development/test only: keeps messages in memory and logs that one was sent. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly sent: { to: string; body: string }[] = [];
  async send(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
    // Dev convenience: show the message so codes can be typed in locally.
    log.info('sms (console provider)', { to, body });
  }
}

/**
 * Generic HTTPS JSON provider: POST {to, sender, body} with a bearer token.
 * Most Egyptian SMS gateways need a small adapter — write it here, keeping the
 * same interface. Timeouts and non-2xx responses are errors so the outbox retries.
 */
export class HttpSmsProvider implements SmsProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly sender: string,
  ) {}

  async send(to: string, body: string): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ to, sender: this.sender, body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`sms provider responded ${res.status}`);
  }
}

/**
 * Brevo transactional SMS (same API key as Brevo email; SMS credits are bought separately in Brevo).
 * https://developers.brevo.com/docs/transactional-sms-endpoints
 */
export class BrevoSmsProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly sender: string,
  ) {}

  async send(to: string, body: string): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': this.apiKey },
      // Alphanumeric sender names are limited to 11 characters.
      body: JSON.stringify({ sender: this.sender.slice(0, 11), recipient: to.replace(/^\+/, ''), content: body, type: 'transactional' }),
      signal: AbortSignal.timeout(10_000),
    });
    // Never include the response body in errors: it can echo the phone number.
    if (!res.ok) throw new Error(`sms provider responded ${res.status}`);
  }
}

export function createSmsProvider(cfg: Config): SmsProvider {
  if (cfg.SMS_PROVIDER === 'brevo') return new BrevoSmsProvider(cfg.BREVO_API_KEY!, cfg.SMS_SENDER_ID);
  if (cfg.SMS_PROVIDER === 'http') return new HttpSmsProvider(cfg.SMS_HTTP_URL!, cfg.SMS_HTTP_TOKEN!, cfg.SMS_SENDER_ID);
  if (cfg.SMS_PROVIDER === 'none') return new NoSmsProvider();
  return new ConsoleSmsProvider();
}
