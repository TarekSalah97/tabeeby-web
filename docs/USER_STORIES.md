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

**D4 — Patient files (clinical records; switched on per doctor by an admin).** As a doctor, I want a file for each patient with their personal details and medical background, so that I have their history at every visit.
- Open a file from an appointment (linked to the patient's account) or for a walk-in patient; the patient's consent must be confirmed (I).
- Age is calculated from date of birth (U); allergies are shown at the top of the file and every visit (I).
- A walk-in file with the same phone can be linked when that patient later books; a file linked to another account cannot be relinked (I).
- Edits keep the earlier version (I). Every opening is audited (I).
- Another doctor, another patient or a visitor can never see or change a file (I).

**D5 — Visits, prescriptions and lab orders.** As a doctor, I want to record a visit, write a prescription and order tests in one place, so that the patient leaves with printed papers and the visit is on file.
- Notes: chief complaint (required), history, examination, diagnosis, plan (I).
- Prescription lines: medicine and strength, form, dose, how often, when, how long, instructions; blank lines are ignored, incomplete lines are named and nothing is saved (U, I).
- Medicine suggestions come from the doctor's own past prescriptions; picking one fills its form (I).
- Lab and imaging orders from a fixed list plus free text (U, I).
- Visit, prescription and lab order are saved together or not at all (I).
- Prescriptions and lab orders are never edited, only cancelled with a reason; the database refuses changes (I).
- Printable A4 page in Arabic or English (I).

## Patients — symptom checker

**P-SC — Which specialist do I need?** As a patient who doesn't know which doctor to see, I want to describe my symptoms and get a suggested specialty, so that I book the right doctor.
- Only shown when an AI provider key is configured (I). Consent required before anything is sent (I).
- Suggestions only from Tabeeby's specialties, best first, max 3, each linking to matching doctors (I).
- Emergency warning signs (Arabic and English, many wordings) always show "call 123", whatever the AI says (U, I).
- If the AI fails or the daily cap is reached, keyword matching is used and labelled (I). 8 requests per hour per visitor (I).
- The description is never stored (I). It is guidance, never a diagnosis.

## Patients — prescriptions

**P-RX — My prescriptions.** As a patient, I want to see the prescriptions and lab orders my doctors issued, so that I can show them at the pharmacy or lab.
- Only for files linked to my account; cancelled ones disappear; the doctor's notes are never shown (I).

## Admins

**A1 — Verify doctors.** See pending doctors, open the syndicate card (every opening audited) (I), approve (doctor gets an SMS and becomes visible) (I), reject or suspend with a required reason (I). Suspension signs the doctor out and hides them (I).
- Only admins can reach admin pages and documents (I).

## Batch 1 — trust & easy booking

**P-RV — Verified reviews.** As a patient, I want to rate a visit I actually had, so that other patients can choose with confidence.
- Only the patient of a **completed** appointment can rate it, 1–5 stars plus an optional comment (≤500 chars); one review per visit, editable (I).
- Another patient's visit returns "not found"; doctors and visitors cannot post reviews (I).
- Profile and search show the average and count of visible reviews; reviews show first name + last initial only, never the full name (I).
- Admins can hide a review with a required reason and show it again; an author editing a hidden review does not unhide it (I).
- The doctor's dashboard shows their rating (I).

**P-WL — Waitlist for fully booked days.** As a patient, I want to be told when a place opens on a full day, so that I can still see the doctor I want.
- A day is "full" when the clinic works that day but every slot is booked; days off and days with free times are refused (I).
- Up to 3 active waitlist days per patient; joining the same day twice is refused (I).
- When any booking that day is cancelled (by patient or doctor), everyone waiting is notified by SMS (when SMS is on) and on My appointments; the first to book gets the place — the database still prevents double booking (I).
- Booking that day closes the patient's entry; only the owner can leave an entry; past days expire (I).

**P-RB — Rebook and quick actions.** As a returning patient, I want my doctors and my next visit one tap away.
- Signed-in patients see their next visit, quick tiles and "Book again" for previous doctors on the home page (I).
- Every past visit has "Book again"; completed visits have "Rate visit"; upcoming visits have Directions and Call (I, E).
- On phones, patients get a bottom tab bar (Home, Search, Visits, Prescriptions) and doctor profiles pin Book / Call / Directions to the bottom of the screen (E).

**D-EZ — Doctor's day on a phone.** As a doctor, I want to run my clinic day from my phone.
- The day's visits show as cards on phones with the next-step button full width and at least 44px tall; no sideways scrolling (E).
- Dashboard sections are tabs across the top on phones.

## Booking without an account and patient sign-in page

**P-GB — Book with an emailed code.** As a visitor without an account, I want to book with my name, mobile and email, so that I don't have to sign up first.
- Shown only when an email service is configured; otherwise visitors sign in to book as before (I).
- A 6-digit code (15 minutes, 5 tries, single use, stored hashed) is emailed; nothing is created until it is confirmed (I).
- The right code creates a patient account (email confirmed, no password yet), signs the visitor in and books through the normal booking rules; the visit shows in My appointments and on the doctor's schedule with the patient's mobile and email (I).
- A mobile or email that already has an account must sign in instead — an email code never opens an existing account (I).
- Patients can later sign in with an emailed code (patients only; same answer for unknown emails) or set a password (I).
- With SMS on, the new account also verifies its mobile before the booking is made (I).

**P-GT — Patient-only pages explain how to get in.** Visitors who open My appointments or My prescriptions & tests see a page with "Sign in as a patient" and "Create a patient account" that brings them back afterwards; staff are pointed to their dashboard (I).

## Admin console (modelled on the old app's admin dashboard)

- As an admin, I want one dashboard with counts of doctors, patients and activity for a date range I pick, so that I can see how the platform is doing at a glance.
  - Given I am an admin, When I open `/admin`, Then I see active/pending/suspended doctors, registered patients, and bookings, completed visits, waitlist joins, cancellations, no-shows, new patients and reviews.
  - Given I pick "Today", "7 days", "30 days", "This month" or a custom from–to, Then only the activity counts change; people counts stay totals. A backwards custom range is swapped; an invalid one falls back to "All time".
  - Given messages failed to send, Then a warning links to Messages & settings and the quick-action tile shows a count.
- As an admin, I want to find any account by name, email or mobile and suspend or reactivate it with a reason, so that I can stop abuse quickly.
  - Given I suspend an account, Then a reason (3+ characters) is required, the person is signed out at once, cannot sign in, a suspended doctor disappears from search, and the action is recorded in the audit log. Existing bookings are kept.
  - Given the account is an admin, Then suspension is refused.
- As an admin, I want to search the audit log by action, record and who did it, within a date range, so that I can answer "who changed this and when".
- As an admin, I want to see which services are connected (SMS, email, AI assistant), this week's message counts and the latest failed messages with masked recipients, and retry failures from the last 7 days, so that patients get their confirmations.
- Every admin page is admin-only (patients and doctors get 403; visitors are sent to sign in) and fits a phone screen.

## Clinic day

- As a doctor, I want to set a follow-up ("متابعة / استشارة") price and period per clinic, so that returning patients pay the right amount.
  - Given the follow-up price is higher than the consultation fee, Then saving is refused. Empty = same price as a new visit. Period 1–90 days (default 14).
  - Given a patient finished a visit with me within the period, When they book online, Then they are charged the follow-up price and the confirm page says why; otherwise the full fee. Patients cannot choose the type (the server decides).
- As a doctor, I want to add a booking for someone who calls or walks in (name + mobile), so that my whole day is in one list.
  - Only free times from my schedule are offered (including the slot running now); two bookings can never overlap; up to 90 days ahead.
  - These bookings are kept with my clinic only and never shown to any patient account (a mistyped number cannot reveal a visit to a stranger). They are marked "Booked by clinic".
- As a doctor, I want a "Book follow-up" button on a finished or ongoing visit, so that I can schedule the next visit before the patient leaves (In 1 week / 2 weeks / 1 month).
  - The follow-up uses the follow-up price. A patient with an account sees it in "My appointments" and gets a confirmation.
- As a doctor, I want to see how much I collected from completed visits today.
- As a clinic, I want patients who miss appointments to stop booking online, so that times are not wasted.
  - Given 3 no-shows in 180 days (settings `NO_SHOW_LIMIT`, `NO_SHOW_WINDOW_DAYS`), When the patient books online, Then they are asked to call the clinic. The clinic can still book them. Doctors see the no-show count next to the name.
  - An admin can lift the pause from the accounts page ("Allow online booking again"); earlier no-shows stop counting. Recorded in the audit log.

## Messaging

- As a doctor, I want to switch messaging on and choose the days and hours patients can write, so that questions arrive when I can handle them.
  - Off by default. At least one day; end time after start. Outside the hours patients see when they can write; I can reply at any time.
- As a patient, I want to message a doctor I booked with, so that I can ask a short question between visits.
  - Only with a non-cancelled booking with that doctor in the last 180 days or upcoming; otherwise the page says to book first. 1–1,000 characters; 20 messages a day per doctor.
  - Every conversation shows that messages are not for emergencies (call 123).
- As a doctor, I want to block a patient from sending new messages (and undo it).
- As either side, I want to see unread conversations (badge in the dashboard menu / patient tab bar) and get one text alert per batch of new messages; email for replies if my email is confirmed.
  - Alerts never include the message text (health data). Only the two participants can read a conversation; other doctors get 404, admins 403.
