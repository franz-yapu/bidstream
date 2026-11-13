-- CreateTable
CREATE TABLE "lot_decision" (
    "lot_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "starting_price" DECIMAL(12,2) NOT NULL,
    "min_increment" DECIMAL(12,2) NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "lot_status" NOT NULL,
    "current_price" DECIMAL(12,2),
    "current_bidder" UUID,
    "winner_id" UUID,

    CONSTRAINT "lot_decision_pkey" PRIMARY KEY ("lot_id")
);

-- CreateIndex
CREATE INDEX "lot_decision_tenant_id_idx" ON "lot_decision"("tenant_id");
