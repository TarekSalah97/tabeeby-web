export type AppointmentStatus = 'confirmed' | 'arrived' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show';
export type Actor = 'patient' | 'doctor' | 'admin';

export interface TransitionInput {
  from: AppointmentStatus;
  to: AppointmentStatus;
  actor: Actor;
  startsAt: Date;
  now: Date;
  cancelCutoffHours: number;
}

/** Returns null when allowed, otherwise the i18n key explaining why not. */
export function checkTransition(i: TransitionInput): string | null {
  const { from, to, actor, startsAt, now } = i;
  const started = now.getTime() >= startsAt.getTime();

  if (to === 'cancelled') {
    if (from !== 'confirmed' && !(from === 'arrived' && actor !== 'patient')) return 'appt.cannotCancel';
    if (actor === 'patient') {
      if (started) return 'appt.cannotCancel';
      if (startsAt.getTime() - now.getTime() < i.cancelCutoffHours * 3600_000) return 'appt.tooLateToCancel';
    }
    return null;
  }

  // Everything below is the doctor running their clinic (admins do not act on visits).
  if (actor !== 'doctor') return 'appt.notAllowed';

  switch (`${from}->${to}`) {
    case 'confirmed->arrived':
      // Patients arrive early; allow from 2 hours before the slot.
      return startsAt.getTime() - now.getTime() <= 2 * 3600_000 ? null : 'appt.tooEarly';
    case 'confirmed->no_show':
      return started ? null : 'appt.notStartedYet';
    case 'arrived->in_consultation':
    case 'in_consultation->completed':
      return null;
    default:
      return 'appt.notAllowed';
  }
}

/** The next action a doctor normally takes, used for the dashboard's main button. */
export function nextDoctorAction(status: AppointmentStatus): AppointmentStatus | null {
  switch (status) {
    case 'confirmed':
      return 'arrived';
    case 'arrived':
      return 'in_consultation';
    case 'in_consultation':
      return 'completed';
    default:
      return null;
  }
}

export const isLive = (s: AppointmentStatus): boolean => s !== 'cancelled';
