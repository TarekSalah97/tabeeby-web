-- Links to the doctor's own Facebook, Instagram and TikTok pages, shown on their public profile.
-- Stored already checked and rewritten as https links to those sites only.
alter table doctors add column facebook_url text check (facebook_url is null or (char_length(facebook_url) <= 200 and facebook_url like 'https://www.facebook.com/%'));
alter table doctors add column instagram_url text check (instagram_url is null or (char_length(instagram_url) <= 200 and instagram_url like 'https://www.instagram.com/%'));
alter table doctors add column tiktok_url text check (tiktok_url is null or (char_length(tiktok_url) <= 200 and (tiktok_url like 'https://www.tiktok.com/@%' or tiktok_url like 'https://vm.tiktok.com/%')));
