-- CreateTable
CREATE TABLE "qlix_tool_grants" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qlix_tool_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qlix_tool_grants_organization_id_tool_key" ON "qlix_tool_grants"("organization_id", "tool");

-- CreateIndex
CREATE INDEX "qlix_tool_grants_organization_id_expires_at_idx" ON "qlix_tool_grants"("organization_id", "expires_at");

-- AddForeignKey
ALTER TABLE "qlix_tool_grants" ADD CONSTRAINT "qlix_tool_grants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qlix_tool_grants" ADD CONSTRAINT "qlix_tool_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
