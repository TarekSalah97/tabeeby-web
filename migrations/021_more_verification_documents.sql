-- More documents at sign-up, so the admin can check identity and licences before approving.
-- Doctors: syndicate card + national ID (required); practice licence, specialist certificate and
-- clinic licence (optional). Pharmacies, labs and scan centres: establishment licence, the
-- responsible manager's syndicate card and national ID (required), the radiation licence for scan
-- centres (required), and the commercial register and tax card (optional).
alter table verification_documents drop constraint verification_documents_kind_check;
alter table verification_documents add constraint verification_documents_kind_check
  check (kind in ('syndicate_card', 'national_id', 'practice_licence', 'specialty_certificate', 'clinic_licence'));

alter table facility_documents drop constraint facility_documents_kind_check;
alter table facility_documents add constraint facility_documents_kind_check
  check (kind in ('licence', 'manager_syndicate_card', 'manager_national_id', 'radiation_licence', 'commercial_register', 'tax_card'));
