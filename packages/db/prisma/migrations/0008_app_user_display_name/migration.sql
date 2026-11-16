-- J2 (ADR-0015): nombre público del usuario, visible en las pujas.
ALTER TABLE "app_user" ADD COLUMN "display_name" TEXT;

-- Relleno de las filas existentes: alias determinista a partir del id (el administrador, fijo).
UPDATE "app_user"
SET "display_name" = CASE
  WHEN "role" = 'ADMIN' THEN 'Administrador ' || left(replace("id"::text, '-', ''), 4)
  ELSE 'Postor ' || left(replace("id"::text, '-', ''), 4)
END;

ALTER TABLE "app_user" ALTER COLUMN "display_name" SET NOT NULL;
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_display_name_length"
  CHECK (char_length("display_name") BETWEEN 2 AND 30);

-- Único por tenant sin distinguir mayúsculas (evita suplantaciones).
CREATE UNIQUE INDEX "app_user_tenant_display_name_key" ON "app_user"("tenant_id", lower("display_name"));
