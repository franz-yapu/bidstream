-- CreateIndex: listado paginado de subastas por tenant (J1), orden (opens_at DESC, id)
CREATE INDEX "auction_tenant_id_opens_at_id_idx" ON "auction"("tenant_id", "opens_at" DESC, "id");
