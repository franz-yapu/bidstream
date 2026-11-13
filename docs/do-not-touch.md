# Subsistemas intocables

No se reescriben ni reestructuran sin un ADR en `docs/adr/`.

| Subsistema | Por qué está protegido | Qué exige tocarlo |
|---|---|---|
| Clave de partición `lotId` | Garantiza el orden por lote; reemplaza el advisory lock ([ADR-0001](adr/0001-clave-de-particion-lotid.md)) | ADR nuevo que reemplace ADR-0001 |
| Patrón outbox (escritura en la misma transacción) | Evita la escritura dual y la pérdida de eventos ([ADR-0002](adr/0002-patron-outbox.md), [ADR-0006](adr/0006-un-unico-relay-activo.md)) | ADR que reemplace al 0002 |
| Log de eventos como fuente de verdad (retención ilimitada) | Habilita el reproceso ([ADR-0009](adr/0009-el-log-es-la-fuente-de-verdad.md)) | ADR que reemplace al 0009 |
| Contrato de eventos (§3, `version`) | Lo consumen 3 grupos independientes con idempotencia ([ADR-0007](adr/0007-consumidores-idempotentes-y-dlq.md)) | ADR + bump de `version` |
| Dominio sin dependencias de infraestructura | Arquitectura hexagonal / Clean Code | ADR |
