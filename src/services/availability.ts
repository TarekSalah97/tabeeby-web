import type { Queryable } from '../db/db.js';
import type { Config } from '../config.js';
import { computeSlots, type Interval, type ScheduleRule, type Slot } from '../domain/availability.js';
import { todayIn, addDays, zonedToUtc } from '../domain/time.js';

/**
 * Loads rules and busy time for several doctors in three queries (no N+1)
 * and computes their bookable slots.
 */
export async function slotsForDoctors(
  db: Queryable,
  cfg: Pick<Config, 'TIME_ZONE' | 'BOOKING_MIN_LEAD_MINUTES'>,
  doctorIds: string[],
  opts: { fromDate?: string; days: number; now: Date; clinicId?: string; ignoreAppointments?: boolean },
): Promise<Map<string, Slot[]>> {
  const result = new Map<string, Slot[]>();
  if (!doctorIds.length) return result;
  const tz = cfg.TIME_ZONE;
  const fromDate = opts.fromDate ?? todayIn(tz, opts.now);
  const windowStart = zonedToUtc(fromDate, '00:00', tz);
  const windowEnd = zonedToUtc(addDays(fromDate, opts.days), '00:00', tz);

  const [rules, appts, blocks] = await Promise.all([
    db.query<{ doctor_id: string; clinic_id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number }>(
      `select c.doctor_id, r.clinic_id, r.weekday, to_char(r.start_time, 'HH24:MI') as start_time,
              to_char(r.end_time, 'HH24:MI') as end_time, r.slot_minutes
         from schedule_rules r join clinics c on c.id = r.clinic_id
        where c.doctor_id = any($1::uuid[]) and c.is_active and ($2::uuid is null or c.id = $2)`,
      [doctorIds, opts.clinicId ?? null],
    ),
    db.query<{ doctor_id: string; starts_at: Date; ends_at: Date }>(
      // Written to match the no-overlap index (doctor, time range) so only the window is read,
      // not the doctor's whole history (same result as starts_at < $3 and ends_at > $2).
      `select doctor_id, starts_at, ends_at from appointments
        where doctor_id = any($1::uuid[]) and status <> 'cancelled'
          and tstzrange(starts_at, ends_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
      [doctorIds, windowStart, windowEnd],
    ),
    db.query<{ doctor_id: string; starts_at: Date; ends_at: Date }>(
      `select doctor_id, starts_at, ends_at from schedule_blocks
        where doctor_id = any($1::uuid[]) and starts_at < $3 and ends_at > $2`,
      [doctorIds, windowStart, windowEnd],
    ),
  ]);

  const busyBy = new Map<string, Interval[]>();
  // ignoreAppointments: the slots the doctor would offer if nobody had booked (used to find fully booked days).
  for (const b of [...(opts.ignoreAppointments ? [] : appts.rows), ...blocks.rows]) {
    const list = busyBy.get(b.doctor_id) ?? [];
    list.push({ start: b.starts_at, end: b.ends_at });
    busyBy.set(b.doctor_id, list);
  }
  const rulesBy = new Map<string, ScheduleRule[]>();
  for (const r of rules.rows) {
    const list = rulesBy.get(r.doctor_id) ?? [];
    list.push({ clinicId: r.clinic_id, weekday: r.weekday, startTime: r.start_time, endTime: r.end_time, slotMinutes: r.slot_minutes });
    rulesBy.set(r.doctor_id, list);
  }
  for (const id of doctorIds) {
    result.set(
      id,
      computeSlots({
        rules: rulesBy.get(id) ?? [],
        busy: busyBy.get(id) ?? [],
        fromDate,
        days: opts.days,
        tz,
        now: opts.now,
        minLeadMinutes: cfg.BOOKING_MIN_LEAD_MINUTES,
      }),
    );
  }
  return result;
}
