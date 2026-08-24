-- CreateTable
CREATE TABLE "automation_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "credentials" JSONB,
    "connected_email" TEXT,
    "last_used" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_connections_organization_id_idx" ON "automation_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_connections_organization_id_service_name_key" ON "automation_connections"("organization_id", "service_name");

-- AddForeignKey
ALTER TABLE "automation_connections" ADD CONSTRAINT "automation_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
