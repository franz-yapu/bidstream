-- CreateEnum
CREATE TYPE "auction_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "lot_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "auction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "opens_at" TIMESTAMPTZ(3) NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "auction_status" NOT NULL,

    CONSTRAINT "auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot" (
    "id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "starting_price" DECIMAL(12,2) NOT NULL,
    "min_increment" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "closes_at" TIMESTAMPTZ(3) NOT NULL,
    "current_price" DECIMAL(12,2),
    "current_bidder" UUID,
    "status" "lot_status" NOT NULL,
    "winner_id" UUID,

    CONSTRAINT "lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "awarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "event_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "handled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateTable
CREATE TABLE "outbox_message" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auction_tenant_id_status_idx" ON "auction"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "lot_tenant_id_status_closes_at_idx" ON "lot"("tenant_id", "status", "closes_at");

-- CreateIndex
CREATE INDEX "bid_ranking_idx" ON "bid"("lot_id", "amount" DESC, "placed_at", "id");

-- CreateIndex
CREATE INDEX "outbox_message_published_at_created_at_idx" ON "outbox_message"("published_at", "created_at");

-- AddForeignKey
ALTER TABLE "lot" ADD CONSTRAINT "lot_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid" ADD CONSTRAINT "bid_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices parciales (Prisma no los expresa en el esquema; ver docs/sdd/B1/SDD.md §2.5)

-- Adjudicación única (regla de negocio #5): como mucho una puja adjudicada por lote.
CREATE UNIQUE INDEX "bid_one_awarded_per_lot_idx" ON "bid"("lot_id") WHERE "awarded";

-- El relay solo recorre los mensajes pendientes de publicar; el índice se mantiene pequeño.
CREATE INDEX "outbox_message_pending_idx" ON "outbox_message"("created_at") WHERE "published_at" IS NULL;
