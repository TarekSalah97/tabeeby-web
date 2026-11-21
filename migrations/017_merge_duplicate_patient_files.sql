-- One-time clean-up: a doctor's files with the same mobile number and the same name (ignoring case
-- and extra spaces) are the same patient, created again at each walk-in. Merge each group into one
-- file: the file linked to a patient account (or else the oldest) keeps everything, visits move to it,
-- empty fields are filled and longer notes are joined. Groups linked to two different accounts are
-- left alone. Every merged-away file is kept in record_revisions and the merge is audited.
-- (From now on the app reuses the existing file instead of creating a new one.)
do $$
declare
  g record;
  keeper uuid;
  other record;
  k record;
  joined text;
begin
  for g in
    select doctor_id, phone_e164, lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')) as name_key
      from patient_records
     where phone_e164 is not null
     group by 1, 2, 3
    having count(*) > 1 and count(distinct patient_user_id) <= 1
  loop
    select id into keeper from patient_records
     where doctor_id = g.doctor_id and phone_e164 = g.phone_e164 and lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')) = g.name_key
     order by (patient_user_id is null), created_at
     limit 1;

    for other in
      select * from patient_records
       where doctor_id = g.doctor_id and phone_e164 = g.phone_e164 and lower(regexp_replace(btrim(full_name), '\s+', ' ', 'g')) = g.name_key
         and id <> keeper
       order by created_at
    loop
      select * into k from patient_records where id = keeper;
      insert into record_revisions (entity_type, entity_id, doctor_id, data) values ('patient_record', keeper, g.doctor_id, to_jsonb(k));
      insert into record_revisions (entity_type, entity_id, doctor_id, data) values ('patient_record', other.id, g.doctor_id, to_jsonb(other));

      update encounters set record_id = keeper where record_id = other.id and doctor_id = g.doctor_id;

      update patient_records p set
        patient_user_id     = coalesce(p.patient_user_id, other.patient_user_id),
        date_of_birth       = coalesce(p.date_of_birth, other.date_of_birth),
        sex                 = coalesce(p.sex, other.sex),
        occupation          = coalesce(p.occupation, other.occupation),
        marital_status      = coalesce(p.marital_status, other.marital_status),
        habits              = array(select distinct unnest(p.habits || other.habits)),
        habits_note         = left(case when other.habits_note is null or strpos(lower(coalesce(p.habits_note, '')), lower(other.habits_note)) > 0 then p.habits_note
                                    else concat_ws(E'\n', p.habits_note, other.habits_note) end, 500),
        allergies           = left(case when other.allergies is null or strpos(lower(coalesce(p.allergies, '')), lower(other.allergies)) > 0 then p.allergies
                                    else concat_ws(E'\n', p.allergies, other.allergies) end, 2000),
        chronic_conditions  = left(case when other.chronic_conditions is null or strpos(lower(coalesce(p.chronic_conditions, '')), lower(other.chronic_conditions)) > 0 then p.chronic_conditions
                                    else concat_ws(E'\n', p.chronic_conditions, other.chronic_conditions) end, 2000),
        past_history        = left(case when other.past_history is null or strpos(lower(coalesce(p.past_history, '')), lower(other.past_history)) > 0 then p.past_history
                                    else concat_ws(E'\n', p.past_history, other.past_history) end, 2000),
        current_medications = left(case when other.current_medications is null or strpos(lower(coalesce(p.current_medications, '')), lower(other.current_medications)) > 0 then p.current_medications
                                    else concat_ws(E'\n', p.current_medications, other.current_medications) end, 2000),
        family_history      = left(case when other.family_history is null or strpos(lower(coalesce(p.family_history, '')), lower(other.family_history)) > 0 then p.family_history
                                    else concat_ws(E'\n', p.family_history, other.family_history) end, 2000),
        updated_at          = greatest(p.updated_at, other.updated_at)
      where p.id = keeper;

      delete from patient_records where id = other.id;
      insert into audit_log (actor_user_id, action, entity_type, entity_id, metadata)
        values (null, 'record.merge_duplicate', 'patient_record', keeper::text, jsonb_build_object('mergedFrom', other.id, 'doctorId', g.doctor_id));
    end loop;
  end loop;
end $$;
