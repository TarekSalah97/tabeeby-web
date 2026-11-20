# v1 user stories and acceptance criteria

Each criterion maps to an automated test where marked (U = unit, I = integration, E = browser).

## Patients

**P1 — Search.** As a patient, I want to search by specialty, subspecialty, condition, district and insurance, so that I find a doctor who treats my problem near me.
- Given approved doctors in Smouha, when I search "palpitations", then cardiologists appear (I).
- Given a doctor is pending, rejected or suspended, then they never appear in search or have a public page (I).
- Given no matches, then I see a clear empty state, not an error.
- Results are sorted by soonest availability and show up to 3 next times.

**P2 — Book.** As a patient, I want to book a real free time, so that I get a confirmed appointment.
- Given I'm signed out, when I pick a time, then I sign in and return to the same booking (E).
- Given my phone is unverified, then I must verify before booking (I).
- Given a time that is not a real slot, then the booking is refused (I).
- Given 12 patients book the same slot at once, then exactly one succeeds and the rest are told it was taken (I).
- Given I already have 5 upcoming appointments, then I can't book a sixth (I).
- The fee is copied from the clinic on the server, never from the browser (I).
- On success I get an SMS confirmation (I) and reminders 24h and 2h before.

**P3 — Manage.** As a patient, I want to see and cancel my appointments, so that I can change plans.
- Given more than 2 hours remain, then I can cancel (I); given less, then I'm told to call the clinic (U).
- Given someone else's appointment id, then cancelling fails with "not found" (I).

**P4 — Account.** Sign up with name, +20 mobile and a 9+ character password with a show-password toggle (E); verify with a 6-digit SMS code (I); wrong password and unknown phone give the same message (I); repeated failures are rate-limited (I).

## Doctors

**D1 — Join.** As a doctor, I want to sign up with my credentials, so that patients can find me once verified.
- Required: name, email, +20 mobile, password, doctor/dentist, specialty, graduation year, syndicate membership card (PDF/JPG/PNG ≤10 MB) and consent (I).
- Subspecialties must belong to the chosen specialty (I).
- Files are checked by content, not name (I).
- Experience is calculated from positions; overlaps count once — 2021–2023 + 2022–2024 = 3 years (U, I).
- Start dates can't be in the future (U, I).

**D2 — Set up.** Add clinics (district within the city, address, fee — Arabic digits accepted) (I); add weekly hours per clinic; overlapping hours on the same day are refused (I); block days off, which removes those days from booking (I).

**D3 — Run the day.** See the day's appointments with patient name, phone and reason; mark arrived → start → finish; mark no-show only after the time; cancel (patient gets an SMS) (U, I).
- Another doctor can never see or change these appointments (I).

## Admins

**A1 — Verify doctors.** See pending doctors, open the syndicate card (every opening audited) (I), approve (doctor gets an SMS and becomes visible) (I), reject or suspend with a required reason (I). Suspension signs the doctor out and hides them (I).
- Only admins can reach admin pages and documents (I).
