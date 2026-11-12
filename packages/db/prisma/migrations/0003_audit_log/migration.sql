-- CreateTable
CREATE TABLE "audit_log" (
    "event_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "source_topic" TEXT NOT NULL,
    "source_partition" INTEGER NOT NULL,
    "source_offset" BIGINT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_occurred_at_idx" ON "audit_log"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_key_occurred_at_idx" ON "audit_log"("key", "occurred_at");

-- Append-only (docs/sdd/D6/SDD.md §2.3): la bitácora solo admite INSERT. Los disparadores detienen
-- errores y usos accidentales; la garantía frente a un atacante con las credenciales de la
-- aplicación es un rol de base de datos con solo INSERT y SELECT (se aplica al desplegar, H1).
CREATE FUNCTION audit_log_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es append-only: % no está permitido', TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
