# Personal data inventory (v1)

For the data-protection lawyer and the PDPC licence application. "Sensitive" follows Egypt's PDPL, where health data is sensitive personal data.

| Table.field | Whose | Sensitive? | Purpose | Who can see it | Retention (proposed — lawyer to confirm) |
|---|---|---|---|---|---|
| users.full_name | patients, doctors, admins | No | Identify the account; shown to the doctor on bookings | User, their doctors, admins | Account lifetime + 1 year |
| users.phone_e164 | all | No | Sign-in, OTP, booking SMS | User, their doctors (to contact), admins | Account lifetime + 1 year |
| users.email | doctors, admins | No | Doctor contact | User, admins | Account lifetime + 1 year |
| users.password_hash | all | No (secret) | Authentication | Nobody (one-way hash) | Account lifetime |
| sessions, otp_codes | all | No | Sign-in | Nobody (hashes only) | Sessions ≤30 days; OTP rows deleted after 2 days |
| appointments (time, clinic, status, visit type) | patients | **Health-adjacent** (that a person sees a given specialist) | Booking, reminders, doctor's schedule | Patient, that doctor | Proposed 2 years, then anonymise patient link |
| appointments.reason | patients | **Yes — health data** | Optional note for the treating doctor | Patient, that doctor only | Same as appointment; consider deleting after the visit |
| doctors.* (specialty, title, bio, graduation year, languages, gender) | doctors | No | Public profile | Public once approved | While listed |
| doctor_positions | doctors | No | Experience shown on profile | Public once approved, admins | While listed |
| verification_documents (syndicate card file) | doctors | ID document | Verify licence to practise | Admins only; every view audited | Proposed 1 year after verification decision |
| notification_outbox (phone, SMS text incl. doctor name and time) | patients, doctors | **Health-adjacent** | Deliver SMS | Operators with DB access | Deleted after 30 days (worker cleanup) |
| audit_log (actor id, action, record id, IP) | all | No | Security and accountability | Admins with DB access | Proposed 1 year |
| rate_limits (keys contain phone numbers and IPs) | all | No | Abuse prevention | Nobody in UI | Deleted after 2 days |
| patient_records (name, phone, date of birth, sex, occupation, marital status, habits, allergies, chronic conditions, past/family history, current medications) | patients (booked and walk-in) | **Yes — health data** | The treating doctor's patient file (clinical records feature, switched on per doctor) | That doctor only; every opening audited | Medical-record retention rules apply — lawyer/Ministry of Health to confirm |
| encounters (chief complaint, history, examination, diagnosis, plan) | patients | **Yes — health data** | Visit notes | That doctor only (never shown to the patient in the app) | As above |
| prescriptions, prescription_items, lab_orders, lab_order_items | patients | **Yes — health data** | Prescriptions and lab/imaging requests; never edited, only cancelled | That doctor; the patient (if the file is linked to their account, and not cancelled) | As above |
| record_revisions | patients | **Yes — health data** | Earlier versions of edited files and visit notes | Nobody in the UI (database operators) | As above |
| doctor_medicines (medicine names a doctor has prescribed) | doctors | No | Type-ahead suggestions | That doctor | While the doctor's account exists |

| reviews (rating 1–5, optional comment ≤500 chars, linked to one completed appointment) | patients | **Health-adjacent** (shows that the person visited that doctor; comments may contain health details despite the on-form warning) | Verified public reviews | Public: rating, comment, first name + last initial, date. Admins: full name. The doctor sees only what the public sees | While the doctor is listed; hidden reviews are kept so they can be restored — lawyer to confirm |
| waitlist_entries (patient, clinic, wanted date, status) | patients | **Health-adjacent** | Tell waiting patients when a place opens | Patient; operators with DB access | Marked expired after the day passes; proposed deletion after 90 days |

| Symptom checker description, age group, sex | visitors and patients | **Yes — health data** | Suggest a specialty | Sent to the AI provider (Anthropic, USA) only after the visitor ticks a consent box; **not stored by Tabeeby** (not in the database or logs). Only a per-IP request counter is kept (rate_limits). | Not stored |

**Data processors to list:** hosting provider, SMS gateway (receives phone numbers and message text), backup storage provider, AI provider for the symptom checker (Anthropic; receives the symptom description).

**Not collected:** lab results (only the requests), payment cards, national ID numbers, location tracking, analytics cookies.

**Open items for the lawyer**
1. Hosting location vs. cross-border transfer licence.
2. Whether `appointments.reason` should be collected at all, and its retention.
3. Consent wording on sign-up (currently: agree to Terms and Privacy Policy) — is separate explicit consent for health-adjacent booking data required?
4. Data-subject request process (access, correction, deletion) — v1 has no self-service deletion; requests are handled by admins in the database.
5. Whether a Data Protection Officer must be appointed.
6. Clinical records (patient files, visit notes, prescriptions, lab orders) are sensitive health data stored outside Egypt. The feature is off by default and switched on per doctor by an admin; confirm the PDPC licence, cross-border transfer, consent wording ("The patient agreed that I keep a medical file for them on Tabeeby", recorded with a timestamp) and retention before turning it on for real patients.
8. Symptom checker: confirm the consent wording and cross-border transfer of symptom descriptions to Anthropic (USA), and Anthropic's data-retention terms for API inputs.
9. Reviews are published with first name + last initial. Confirm consent wording for publishing, and the policy for removing reviews that contain health details (admins can hide them; they are kept, not deleted).
7. Confirm what an Egyptian prescription must show (e.g. syndicate number, signature) — the printout currently shows the doctor's name, specialty, title, clinic, patient, date, medicines and a signature line.
