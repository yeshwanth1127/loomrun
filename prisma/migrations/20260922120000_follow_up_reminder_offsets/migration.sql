-- Track which advance in-app reminder offsets (60 / 30 / 5) were already shown
-- for the current next_follow_up_at schedule.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_reminded_offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
