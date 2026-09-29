-- CreateTable
CREATE TABLE "ai_speed_dials" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_speed_dials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_speed_dials_slot_check" CHECK ("slot" >= 1 AND "slot" <= 9)
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_speed_dials_organization_id_user_id_slot_key"
ON "ai_speed_dials"("organization_id", "user_id", "slot");

-- CreateIndex
CREATE INDEX "ai_speed_dials_organization_id_user_id_idx"
ON "ai_speed_dials"("organization_id", "user_id");

-- AddForeignKey
ALTER TABLE "ai_speed_dials" ADD CONSTRAINT "ai_speed_dials_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_speed_dials" ADD CONSTRAINT "ai_speed_dials_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
