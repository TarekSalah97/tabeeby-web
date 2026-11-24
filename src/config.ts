import { normalizeEgyptMobile } from './domain/phone.js';
import { z } from 'zod';

/**
 * All runtime configuration comes from environment variables and is validated
 * once at startup. The process refuses to start with an unsafe production config.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    /** Public origin, used for Origin checks and absolute links. e.g. https://tabeeby.com */
    PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
    /**
     * Trust the reverse proxy for the visitor's address. With one proxy (e.g. Caddy) the address it
     * appended last in X-Forwarded-For is used — never the first one, which the visitor can fake.
     */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /**
     * A header set by the edge network that visitors cannot fake, read before X-Forwarded-For.
     * On Render (Cloudflare in front) this is "true-client-ip"; set automatically there.
     */
    CLIENT_IP_HEADER: z
      .string()
      .regex(/^[a-z0-9-]*$/i)
      .default('')
      .transform((s) => s.toLowerCase()),

    // Never echo the value in errors: it contains the database password.
    DATABASE_URL: z
      .string()
      .trim()
      .refine((v) => /^postgres(ql)?:\/\/\S+$/.test(v) && URL.canParse(v), {
        message: 'must be the database connection string, starting with postgresql:// (one line, no spaces)',
      }),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** 'disable' | 'require' (verify cert) | 'no-verify' (encrypt, do not verify — avoid) */
    DATABASE_SSL: z.enum(['disable', 'require', 'no-verify']).default('disable'),
    DATABASE_SSL_CA_FILE: z.string().optional(),

    /** Directory for private uploads (syndicate cards). Must NOT be web-served. */
    UPLOAD_DIR: z.string().default('./var/uploads'),
    /** 'db' stores uploads in PostgreSQL — for hosts whose disk is wiped on restart. */
    STORAGE_DRIVER: z.enum(['disk', 'db']).default('disk'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    /** Whole upload form (several documents at sign-up, several photos on a visit). */
    MAX_FORM_UPLOAD_BYTES: z.coerce.number().int().positive().default(30 * 1024 * 1024),

    /**
     * Per-IP request budget per minute (pages, and form submissions). Protects against floods and
     * scripted guessing on every form. 0 turns the limit off (used by the automated tests).
     */
    RATE_LIMIT_PAGES_PER_MIN: z.coerce.number().int().min(0).default(240),
    RATE_LIMIT_POSTS_PER_MIN: z.coerce.number().int().min(0).default(40),

    /** Phone numbers on the "Contact us" page (comma-separated Egyptian mobiles; call and WhatsApp). */
    SUPPORT_PHONES: z
      .string()
      .default('01017609775,01004704221')
      .transform((s, c) => {
        const list = s.split(',').map((x) => x.trim()).filter(Boolean).map((x) => normalizeEgyptMobile(x));
        if (list.some((x) => !x)) {
          c.addIssue({ code: z.ZodIssueCode.custom, message: 'SUPPORT_PHONES must be Egyptian mobile numbers separated by commas' });
          return z.NEVER;
        }
        return list as string[];
      }),

    /**
     * 'none' = run without SMS: no phone verification, no confirmations or reminders.
     * 'brevo' = Brevo transactional SMS with BREVO_API_KEY (needs SMS credits in Brevo).
     */
    SMS_PROVIDER: z.enum(['console', 'http', 'brevo', 'none']).default('console'),
    SMS_HTTP_URL: z.string().url().optional(),
    SMS_HTTP_TOKEN: z.string().optional(),
    SMS_SENDER_ID: z.string().default('Tabeeby'),

    /**
     * Email (codes for booking without an account, sign-in codes, confirmations).
     * Left unset it is 'brevo' when BREVO_API_KEY is set, otherwise 'none' in production and 'console' elsewhere.
     */
    EMAIL_PROVIDER: z.enum(['console', 'brevo', 'none']).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    /** Sender address confirmed in Brevo, e.g. tabeeby.eg@gmail.com or no-reply@your-domain. */
    EMAIL_FROM: z.string().email().optional(),
    EMAIL_FROM_NAME: z.string().default('Tabeeby طبيبي'),

    /** Patients may cancel/reschedule up to this many hours before the visit. */
    CANCEL_CUTOFF_HOURS: z.coerce.number().int().min(0).max(72).default(2),
    /** How far ahead patients can book. */
    BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Minimum notice for a new booking. */
    BOOKING_MIN_LEAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
    /** Abuse limit: active upcoming appointments per patient. */
    MAX_ACTIVE_APPOINTMENTS_PER_PATIENT: z.coerce.number().int().min(1).max(50).default(5),
    // Online booking pauses after this many no-shows in the window (the clinic can still book them).
    NO_SHOW_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
    NO_SHOW_WINDOW_DAYS: z.coerce.number().int().min(7).max(730).default(180),
    // Online booking with a doctor pauses at this many active strikes (doctor cancellations) in the window.
    STRIKE_LIMIT: z.coerce.number().int().min(1).max(50).default(5),
    STRIKE_WINDOW_DAYS: z.coerce.number().int().min(7).max(730).default(180),

    TIME_ZONE: z.string().default('Africa/Cairo'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    // "Which specialist do I need?" — off unless an Anthropic API key is set.
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().default('claude-haiku-5-5'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
    // Site-wide cap on AI calls per day, to bound cost; past it, keyword matching is used.
    AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(100000).default(500),
    /** Run the notifications worker inside the web process. */
    /**
     * Public demo: fictional data only. Shows a banner, hides the site from search
     * engines, shows SMS codes on screen (console SMS allowed) and lists demo logins.
     * Never enable on a site that real patients use.
     */
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    RUN_WORKER: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    if (!cfg.PUBLIC_ORIGIN.startsWith('https://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PUBLIC_ORIGIN'], message: 'must be https in production' });
    }
    if (cfg.SMS_PROVIDER === 'console' && !cfg.DEMO_MODE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMS_PROVIDER'],
        message: 'console SMS provider is not allowed in production (patients would never receive codes)',
      });
    }
    if (cfg.EMAIL_PROVIDER === 'console' && !cfg.DEMO_MODE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_PROVIDER'], message: 'console email provider is not allowed in production' });
    }
    if (cfg.SMS_PROVIDER === 'brevo' && !cfg.BREVO_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['BREVO_API_KEY'], message: 'BREVO_API_KEY is required for SMS_PROVIDER=brevo' });
    }
    if (cfg.SMS_PROVIDER === 'http' && (!cfg.SMS_HTTP_URL || !cfg.SMS_HTTP_TOKEN)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_HTTP_URL'], message: 'SMS_HTTP_URL and SMS_HTTP_TOKEN are required' });
    }
  });

type ParsedConfig = z.infer<typeof schema>;
export type Config = Omit<ParsedConfig, 'EMAIL_PROVIDER'> & { EMAIL_PROVIDER: 'console' | 'brevo' | 'none' };

/** Resolve the email provider when it was not set explicitly, and check Brevo has what it needs. */
function resolveEmail(cfg: ParsedConfig): Config {
  // A key without a sender address (e.g. half-way through setup) keeps email off rather than stopping the site.
  const brevoReady = !!cfg.BREVO_API_KEY && !!cfg.EMAIL_FROM;
  const provider = cfg.EMAIL_PROVIDER ?? (brevoReady ? 'brevo' : cfg.NODE_ENV === 'production' && !cfg.DEMO_MODE ? 'none' : 'console');
  if (provider === 'brevo' && (!cfg.BREVO_API_KEY || !cfg.EMAIL_FROM)) {
    throw new Error('Invalid configuration:\n  - EMAIL_FROM: BREVO_API_KEY and EMAIL_FROM are both required to send email');
  }
  return { ...cfg, EMAIL_PROVIDER: provider };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Hosting platforms such as Render publish the service URL; use it when PUBLIC_ORIGIN is not set.
  let withOrigin = !env['PUBLIC_ORIGIN'] && env['RENDER_EXTERNAL_URL'] ? { ...env, PUBLIC_ORIGIN: env['RENDER_EXTERNAL_URL'] } : env;
  // On Render, Cloudflare sets True-Client-IP (visitors cannot fake it); X-Forwarded-For is not cleaned.
  if (env['RENDER'] === 'true' && env['CLIENT_IP_HEADER'] === undefined) withOrigin = { ...withOrigin, CLIENT_IP_HEADER: 'true-client-ip' };
  const parsed = schema.safeParse(withOrigin);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return resolveEmail(parsed.data);
}

export const isProduction = (cfg: Config): boolean => cfg.NODE_ENV === 'production';

/** Phone verification is only possible (and required) when SMS can be sent. */
export const smsEnabled = (cfg: Pick<Config, 'SMS_PROVIDER'>): boolean => cfg.SMS_PROVIDER !== 'none';

/** Booking without an account and email sign-in codes need a working email service. */
export const emailEnabled = (cfg: Pick<Config, 'EMAIL_PROVIDER'>): boolean => cfg.EMAIL_PROVIDER !== 'none';
