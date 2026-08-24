-- CreateTable
CREATE TABLE "qlix_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "credentials" JSONB,
    "qlix_org_id" TEXT,
    "agent_id" TEXT,
    "collection_id" TEXT,
    "mcp_server_id" TEXT,
    "provision_step" TEXT,
    "backfill_state" JSONB,
    "backfill_done_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_sweep_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qlix_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qlix_sync_queue" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "op" TEXT NOT NULL DEFAULT 'upsert',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qlix_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qlix_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "qlix_document_id" TEXT,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qlix_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qlix_connections_organization_id_key" ON "qlix_connections"("organization_id");

-- CreateIndex
CREATE INDEX "qlix_connections_status_idx" ON "qlix_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "qlix_sync_queue_organization_id_entity_type_entity_id_status_key" ON "qlix_sync_queue"("organization_id", "entity_type", "entity_id", "status");

-- CreateIndex
CREATE INDEX "qlix_sync_queue_status_created_at_idx" ON "qlix_sync_queue"("status", "created_at");

-- CreateIndex
CREATE INDEX "qlix_sync_queue_organization_id_status_idx" ON "qlix_sync_queue"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qlix_documents_organization_id_external_id_key" ON "qlix_documents"("organization_id", "external_id");

-- CreateIndex
CREATE INDEX "qlix_documents_organization_id_created_at_idx" ON "qlix_documents"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "qlix_connections" ADD CONSTRAINT "qlix_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qlix_sync_queue" ADD CONSTRAINT "qlix_sync_queue_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qlix_documents" ADD CONSTRAINT "qlix_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN "qlix_conversation_id" TEXT;

-- AlterTable
ALTER TABLE "ai_pending_actions" ADD COLUMN "jit_request_id" TEXT;
ALTER TABLE "ai_pending_actions" ADD COLUMN "qlix_run_id" TEXT;
