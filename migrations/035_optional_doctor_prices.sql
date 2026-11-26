-- Doctors may choose not to show their prices: an empty consultation price means
-- "price at the clinic". Appointments booked then have no quoted price either.
alter table clinics alter column fee_egp drop not null;
alter table appointments alter column fee_egp drop not null;
