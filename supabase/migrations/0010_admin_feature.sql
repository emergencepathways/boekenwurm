-- Boekenwurm: an "admin" feature for the owner's own account.
--
-- Experimental settings that aren't open to readers yet (Match my level, for now) are shown only to accounts with the
-- admin feature. It is granted by the owner in the SQL Editor, or through an access code for it; readers can't grant
-- it to themselves (feature_access has no insert policy, 0004).

alter table access_codes drop constraint access_codes_feature_check;
alter table access_codes add constraint access_codes_feature_check check (feature in ('google_page_reading', 'admin'));
alter table feature_access drop constraint feature_access_feature_check;
alter table feature_access add constraint feature_access_feature_check check (feature in ('google_page_reading', 'admin'));
