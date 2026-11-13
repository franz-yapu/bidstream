-- CreateTable
CREATE TABLE "idempotency_key" (
    "tenant_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "command_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("tenant_id","bidder_id","key")
);

-- CreateIndex
CREATE INDEX "idempotency_key_tenant_id_bidder_id_created_at_idx" ON "idempotency_key"("tenant_id", "bidder_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key"("created_at");
