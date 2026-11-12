# Subsistemas intocables

No se reescriben ni reestructuran sin un ADR en `docs/adr/`.

| Subsistema | Por qué está protegido | Qué exige tocarlo |
|---|---|---|
| Clave de partición `lotId` | Garantiza el orden por lote; reemplaza el advisory lock ([ADR-0001](adr/0001-clave-de-particion-lotid.md)) | ADR nuevo que reemplace ADR-0001 |
| Patrón outbox (escritura en la misma transacción) | Evita la escritura dual y la pérdida de eventos | ADR |
| Log de eventos como fuente de verdad (retención ilimitada) | Habilita el reproceso | ADR |
| Contrato de eventos (§3, `version`) | Lo consumen 3 grupos independientes | ADR + bump de `version` |
| Dominio sin dependencias de infraestructura | Arquitectura hexagonal / Clean Code | ADR |
