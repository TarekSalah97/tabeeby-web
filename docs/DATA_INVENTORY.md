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

**Data processors to list:** hosting provider, SMS gateway (receives phone numbers and message text), backup storage provider.

**Not collected in v1:** diagnoses, prescriptions, lab results, payment cards, national ID numbers, location tracking, analytics cookies.

**Open items for the lawyer**
1. Hosting location vs. cross-border transfer licence.
2. Whether `appointments.reason` should be collected at all, and its retention.
3. Consent wording on sign-up (currently: agree to Terms and Privacy Policy) — is separate explicit consent for health-adjacent booking data required?
4. Data-subject request process (access, correction, deletion) — v1 has no self-service deletion; requests are handled by admins in the database.
5. Whether a Data Protection Officer must be appointed.
