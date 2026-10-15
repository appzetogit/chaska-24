-- Rebrand: Minto Foods -> Chaska.
--
-- Same reasoning as the prior rebrand migration: companyName is what the
-- frontend actually renders, so only the DEFAULT moves. Any row already
-- written keeps whatever it holds.
ALTER TABLE "food_business_settings" ALTER COLUMN "companyName" SET DEFAULT 'Chaska';
ALTER TABLE "food_business_settings" ALTER COLUMN "email" SET DEFAULT 'admin@chaska.com';

-- The singleton settings row, if it exists and still carries the old
-- default, is the one case where rewriting is right: nobody chose that
-- value deliberately.
UPDATE "food_business_settings" SET "companyName" = 'Chaska' WHERE "companyName" = 'Minto Foods';
UPDATE "food_business_settings" SET "email" = 'admin@chaska.com' WHERE "email" = 'admin@mintofood.com';
