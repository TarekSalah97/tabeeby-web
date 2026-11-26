export type VisitType = 'new' | 'follow_up' | 'service';

/** A quoted visit: consultation, follow-up, or one of the doctor's own services (with its name). */
export interface Visit {
  type: VisitType;
  /** Null: the doctor shows no price (paid at the clinic). */
  fee: number | null;
  serviceId?: string;
  serviceName?: string;
  serviceNameAr?: string | null;
}

export interface ClinicPrices {
  /** Null: the doctor chose not to show prices. */
  fee: number | null;
  /** Null: follow-ups cost the same as a new visit. */
  followUpFee: number | null;
  followUpDays: number;
}

export const priceOf = (p: ClinicPrices, type: VisitType): number | null => (type === 'follow_up' ? (p.followUpFee ?? p.fee) : p.fee);

/**
 * What an online booking counts as. A follow-up needs a finished visit with the same doctor
 * no more than followUpDays before the new appointment. Decided on the server from real visits,
 * so a patient can never pick the cheaper price themselves.
 */
export function visitForOnlineBooking(p: ClinicPrices, lastCompletedAt: Date | null, startsAt: Date): { type: VisitType; fee: number | null } {
  const within = lastCompletedAt !== null && startsAt.getTime() - lastCompletedAt.getTime() <= p.followUpDays * 86400_000 && lastCompletedAt <= startsAt;
  const type: VisitType = within ? 'follow_up' : 'new';
  return { type, fee: priceOf(p, type) };
}
