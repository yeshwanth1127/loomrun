-- CreateTable
CREATE TABLE "ai_org_memories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "facts" JSONB NOT NULL,
    "last_extracted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_org_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_org_memories_organization_id_key" ON "ai_org_memories"("organization_id");

-- AddForeignKey
ALTER TABLE "ai_org_memories" ADD CONSTRAINT "ai_org_memories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
