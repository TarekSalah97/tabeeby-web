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
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

    SMS_PROVIDER: z.enum(['console', 'http']).default('console'),
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
    /** Run the notifications worker inside the web process. */
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
    if (cfg.SMS_PROVIDER === 'console') {
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
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export const isProduction = (cfg: Config): boolean => cfg.NODE_ENV === 'production';
