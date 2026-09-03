-- Telecaller WhatsApp number (org → employee reminder destination)
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "whatsapp_phone" TEXT;

-- Reminder ack / send tracking (reset when next_follow_up_at is rescheduled)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_reminded_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_wa_reminded_at" TIMESTAMP(3);
