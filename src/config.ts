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
    /** Trust X-Forwarded-For from the reverse proxy (Caddy) for client IPs. */
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** 'disable' | 'require' (verify cert) | 'no-verify' (encrypt, do not verify — avoid) */
    DATABASE_SSL: z.enum(['disable', 'require', 'no-verify']).default('disable'),
    DATABASE_SSL_CA_FILE: z.string().optional(),

    /** Directory for private uploads (syndicate cards). Must NOT be web-served. */
    UPLOAD_DIR: z.string().default('./var/uploads'),
    /** 'db' stores uploads in PostgreSQL — for hosts whose disk is wiped on restart. */
    STORAGE_DRIVER: z.enum(['disk', 'db']).default('disk'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

    /** 'none' = run without SMS: no phone verification, no confirmations or reminders. */
    SMS_PROVIDER: z.enum(['console', 'http', 'none']).default('console'),
    SMS_HTTP_URL: z.string().url().optional(),
    SMS_HTTP_TOKEN: z.string().optional(),
    SMS_SENDER_ID: z.string().default('Tabeeby'),

    /** Patients may cancel/reschedule up to this many hours before the visit. */
    CANCEL_CUTOFF_HOURS: z.coerce.number().int().min(0).max(72).default(2),
    /** How far ahead patients can book. */
    BOOKING_HORIZON_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Minimum notice for a new booking. */
    BOOKING_MIN_LEAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(30),
    /** Abuse limit: active upcoming appointments per patient. */
    MAX_ACTIVE_APPOINTMENTS_PER_PATIENT: z.coerce.number().int().min(1).max(50).default(5),

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
    if (cfg.SMS_PROVIDER === 'http' && (!cfg.SMS_HTTP_URL || !cfg.SMS_HTTP_TOKEN)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_HTTP_URL'], message: 'SMS_HTTP_URL and SMS_HTTP_TOKEN are required' });
    }
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Hosting platforms such as Render publish the service URL; use it when PUBLIC_ORIGIN is not set.
  const withOrigin = !env['PUBLIC_ORIGIN'] && env['RENDER_EXTERNAL_URL'] ? { ...env, PUBLIC_ORIGIN: env['RENDER_EXTERNAL_URL'] } : env;
  const parsed = schema.safeParse(withOrigin);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export const isProduction = (cfg: Config): boolean => cfg.NODE_ENV === 'production';

/** Phone verification is only possible (and required) when SMS can be sent. */
export const smsEnabled = (cfg: Pick<Config, 'SMS_PROVIDER'>): boolean => cfg.SMS_PROVIDER !== 'none';
