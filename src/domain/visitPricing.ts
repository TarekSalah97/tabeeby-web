export type VisitType = 'new' | 'follow_up' | 'service';

/** A quoted visit: consultation, follow-up, or one of the doctor's own services (with its name). */
export interface Visit {
  type: VisitType;
  fee: number;
  serviceId?: string;
  serviceName?: string;
}

export interface ClinicPrices {
  fee: number;
  /** Null: follow-ups cost the same as a new visit. */
  followUpFee: number | null;
  followUpDays: number;
}

export const priceOf = (p: ClinicPrices, type: VisitType): number => (type === 'follow_up' ? (p.followUpFee ?? p.fee) : p.fee);

/**
 * What an online booking counts as. A follow-up needs a finished visit with the same doctor
 * no more than followUpDays before the new appointment. Decided on the server from real visits,
 * so a patient can never pick the cheaper price themselves.
 */
export function visitForOnlineBooking(p: ClinicPrices, lastCompletedAt: Date | null, startsAt: Date): { type: VisitType; fee: number } {
  const within = lastCompletedAt !== null && startsAt.getTime() - lastCompletedAt.getTime() <= p.followUpDays * 86400_000 && lastCompletedAt <= startsAt;
  const type: VisitType = within ? 'follow_up' : 'new';
  return { type, fee: priceOf(p, type) };
}
